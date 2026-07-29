#!/usr/bin/env bash
#
# setup-tools.sh — idempotent bootstrap of the mxcli (MDL) Mendix toolchain.
#
# The runtime container is ephemeral, so this script re-establishes the full
# toolchain from scratch and is safe to re-run: every step detects first and
# only installs what is missing.
#
#   1. Build/runtime deps ....... Go (GOTOOLCHAIN=auto), JDK 21, Node, PostgreSQL 16
#   2. ANTLR 4.13.1 (pinned) .... /opt/antlr + /usr/local/bin/antlr4 shim
#   3. mxcli from source ........ ako/mxcli @ $MXCLI_REF -> /usr/local/bin/mxcli
#   4. Mendix engine cache ...... MxBuild + runtime for $MENDIX_VERSION
#   5. Verification ............. fails loudly if anything is missing
#
# Overrides:
#   MENDIX_VERSION=11.12.1   Mendix version to pre-cache
#   MXCLI_REF=main           branch/tag/SHA of ako/mxcli to build
#   MXCLI_FORCE_REBUILD=1    rebuild even when the installed binary is current
#   SKIP_MENDIX_CACHE=1      skip the ~1.2 GB MxBuild/runtime download

set -euo pipefail

MENDIX_VERSION="${MENDIX_VERSION:-11.12.1}"
MXCLI_REPO="${MXCLI_REPO:-https://github.com/ako/mxcli.git}"
MXCLI_REF="${MXCLI_REF:-main}"
MXCLI_SRC="${MXCLI_SRC:-/opt/mxcli-src}"
ANTLR_VERSION="${ANTLR_VERSION:-4.13.1}"
ANTLR_JAR="/opt/antlr/antlr-${ANTLR_VERSION}-complete.jar"
ANTLR_URL="https://www.antlr.org/download/antlr-${ANTLR_VERSION}-complete.jar"
MXCLI_HOME="${HOME:-/root}/.mxcli"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[1;32mok\033[0m   %s\n' "$*"; }
skip() { printf '  \033[1;33mskip\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$*" >&2; }

# `java -version` writes JAVA_TOOL_OPTIONS noise to stderr; keep only the version line.
java_version() {
  java -version 2>&1 | grep -m1 'version "' | sed 's/.*version "\([^"]*\)".*/\1/'
}

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo"
fi

apt_installed=0
apt_install() {
  if [ "$apt_installed" -eq 0 ]; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    apt_installed=1
  fi
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@"
}

# Locate the PostgreSQL server binary; it is not on PATH in Debian/Ubuntu layouts.
pg_bindir() {
  if command -v postgres >/dev/null 2>&1; then
    dirname "$(command -v postgres)"
    return 0
  fi
  local d
  for d in /usr/lib/postgresql/*/bin; do
    [ -x "$d/postgres" ] && { echo "$d"; return 0; }
  done
  return 1
}

# ---------------------------------------------------------------------------
# 1. Build/runtime dependencies — detect, then install only what is missing
# ---------------------------------------------------------------------------
log "Checking build/runtime dependencies"

if command -v go >/dev/null 2>&1; then
  ok "Go $(go version | awk '{print $3}') (go.mod pins toolchain 1.26; GOTOOLCHAIN=auto fetches it)"
else
  log "Installing Go"
  apt_install golang-go
  ok "Go $(go version | awk '{print $3}')"
fi
# go.mod requires a newer toolchain than the base image ships; never pin it off.
export GOTOOLCHAIN=auto

if command -v java >/dev/null 2>&1; then
  ok "Java $(java_version)"
else
  log "Installing JDK 21"
  apt_install openjdk-21-jdk-headless
  ok "Java $(java_version)"
fi

if command -v node >/dev/null 2>&1; then
  ok "Node $(node --version)"
else
  log "Installing Node"
  apt_install nodejs npm
  ok "Node $(node --version)"
fi

if PGBIN="$(pg_bindir)"; then
  ok "PostgreSQL server $("$PGBIN/postgres" --version | awk '{print $3}') ($PGBIN)"
else
  log "Installing PostgreSQL 16 server"
  apt_install postgresql-16 postgresql-client-16
  PGBIN="$(pg_bindir)" || { fail "PostgreSQL server still not found after install"; exit 1; }
  ok "PostgreSQL server $("$PGBIN/postgres" --version | awk '{print $3}')"
fi

# Playwright/Chromium ships with the base image — verify only, never reinstall.
CHROMIUM=""
for c in /opt/pw-browsers/chromium/chrome-linux/chrome \
         /opt/pw-browsers/chromium-*/chrome-linux/chrome \
         /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell; do
  [ -x "$c" ] && { CHROMIUM="$c"; break; }
done
[ -z "$CHROMIUM" ] && command -v chromium >/dev/null 2>&1 && CHROMIUM="$(command -v chromium)"
if [ -n "$CHROMIUM" ]; then
  ok "Chromium $CHROMIUM"
else
  fail "Chromium not found under /opt/pw-browsers (screenshot verification unavailable)"
fi

# Make the PostgreSQL server binaries reachable for `mxcli run --local --ensure-db`.
case ":$PATH:" in
  *":$PGBIN:"*) ;;
  *) export PATH="$PGBIN:$PATH" ;;
esac
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export GOTOOLCHAIN=auto"
    echo "export PATH=\"$PGBIN:\$PATH\""
    echo "export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers"
    echo "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
  } >> "$CLAUDE_ENV_FILE"
fi

# ---------------------------------------------------------------------------
# 2. ANTLR — pinned, so `make build`'s parser regen matches antlr4-go/antlr v4.13.1
# ---------------------------------------------------------------------------
log "Pinning ANTLR $ANTLR_VERSION"

if [ -s "$ANTLR_JAR" ]; then
  skip "$ANTLR_JAR already present"
else
  $SUDO mkdir -p /opt/antlr
  $SUDO curl -fsSL -o "$ANTLR_JAR" "$ANTLR_URL"
  ok "downloaded $ANTLR_JAR"
fi

# The shim must come first on PATH: mxcli's Makefile invokes whatever `antlr4`
# it finds, and antlr4-tools would otherwise pull "latest" and drift the parser.
$SUDO tee /usr/local/bin/antlr4 >/dev/null <<EOF
#!/usr/bin/env bash
exec java -jar $ANTLR_JAR "\$@"
EOF
$SUDO chmod 0755 /usr/local/bin/antlr4
ok "antlr4 shim -> $(antlr4 2>&1 | grep -m1 -o 'Version [0-9.]*')"

# ---------------------------------------------------------------------------
# 3. mxcli — built from source off ako/mxcli
# ---------------------------------------------------------------------------
log "Building mxcli from $MXCLI_REPO ($MXCLI_REF)"

if [ -d "$MXCLI_SRC/.git" ]; then
  git -C "$MXCLI_SRC" fetch --depth 1 origin "$MXCLI_REF" --quiet
  git -C "$MXCLI_SRC" checkout --quiet FETCH_HEAD
else
  $SUDO rm -rf "$MXCLI_SRC"
  git clone --depth 1 --branch "$MXCLI_REF" "$MXCLI_REPO" "$MXCLI_SRC" --quiet \
    || git clone --depth 1 "$MXCLI_REPO" "$MXCLI_SRC" --quiet
fi
MXCLI_SHA="$(git -C "$MXCLI_SRC" rev-parse --short HEAD)"

installed_sha=""
if command -v mxcli >/dev/null 2>&1; then
  installed_sha="$(mxcli --version 2>/dev/null | awk '{print $3}')"
fi

if [ "${MXCLI_FORCE_REBUILD:-0}" != "1" ] && [ "$installed_sha" = "$MXCLI_SHA" ]; then
  skip "mxcli $MXCLI_SHA already installed"
else
  # `make build` regenerates the ANTLR parser, syncs embedded assets, then builds.
  ( cd "$MXCLI_SRC" && GOTOOLCHAIN=auto make build )
  $SUDO install -m 0755 "$MXCLI_SRC/bin/mxcli" /usr/local/bin/mxcli
  ok "installed mxcli $MXCLI_SHA -> /usr/local/bin/mxcli"
fi

# ---------------------------------------------------------------------------
# 4. Mendix build engine + runtime, pre-cached (no project required)
# ---------------------------------------------------------------------------
log "Caching Mendix $MENDIX_VERSION build engine and runtime"

MXBUILD_MX="$MXCLI_HOME/mxbuild/$MENDIX_VERSION/modeler/mx"
RUNTIME_DIR="$MXCLI_HOME/runtime/$MENDIX_VERSION"

if [ "${SKIP_MENDIX_CACHE:-0}" = "1" ]; then
  skip "SKIP_MENDIX_CACHE=1"
else
  if [ -x "$MXBUILD_MX" ]; then
    skip "MxBuild $MENDIX_VERSION already cached"
  else
    mxcli setup mxbuild --version "$MENDIX_VERSION"
  fi

  if [ -d "$RUNTIME_DIR/runtime" ]; then
    skip "Mendix runtime $MENDIX_VERSION already cached"
  else
    mxcli setup mxruntime --version "$MENDIX_VERSION"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Verification — fail loudly
# ---------------------------------------------------------------------------
log "Verifying toolchain"
errors=0
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else fail "$1"; errors=$((errors + 1)); fi; }

check "mxcli --help runs"                 "mxcli --help"
check "antlr4 reports $ANTLR_VERSION"     "antlr4 2>&1 | grep -q 'Version $ANTLR_VERSION'"
check "mx validator at $MXBUILD_MX"       "[ -x '$MXBUILD_MX' ]"
check "mxbuild at $MXCLI_HOME/mxbuild/$MENDIX_VERSION/modeler/mxbuild" \
                                          "[ -x '$MXCLI_HOME/mxbuild/$MENDIX_VERSION/modeler/mxbuild' ]"
check "Mendix runtime at $RUNTIME_DIR"    "[ -d '$RUNTIME_DIR/runtime' ]"
check "PostgreSQL server binary"          "[ -x '$PGBIN/postgres' ]"
check "Chromium present"                  "[ -n '$CHROMIUM' ] && [ -x '$CHROMIUM' ]"
check "Java present"                      "java -version"
check "Go present"                        "go version"
check "Node present"                      "node --version"

if [ "${SKIP_MENDIX_CACHE:-0}" = "1" ]; then
  errors=0
fi

cat <<SUMMARY

  Toolchain summary
  -----------------
  mxcli          $(mxcli --version 2>/dev/null || echo 'n/a')  (ako/mxcli @ $MXCLI_REF)
  Mendix         $MENDIX_VERSION (mxbuild + runtime cached under $MXCLI_HOME)
  ANTLR          $ANTLR_VERSION (pinned: $ANTLR_JAR)
  Go             $(go version 2>/dev/null | awk '{print $3}')  GOTOOLCHAIN=auto
  Java           $(java_version)
  Node           $(node --version 2>/dev/null)
  PostgreSQL     $("$PGBIN/postgres" --version 2>/dev/null | awk '{print $3}') ($PGBIN)
  Chromium       ${CHROMIUM:-MISSING}
  Engine         modelsdk (default — do not use --engine legacy)

SUMMARY

if [ "$errors" -ne 0 ]; then
  fail "$errors toolchain check(s) failed"
  exit 1
fi

log "Toolchain ready"

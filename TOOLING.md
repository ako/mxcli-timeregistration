# Toolchain

This repository is a Mendix-app development workspace driven by
[`mxcli`](https://github.com/ako/mxcli) and its MDL (Mendix Definition Language)
scripting layer.

**No Mendix project exists yet.** This commit installs and verifies the toolchain
only — see [Scaffolding the Mendix project](#scaffolding-the-mendix-project) for
the single command a future session runs to create the app.

## Reproducing the environment

The runtime container is ephemeral and is reclaimed after inactivity, so nothing
installed under `/opt`, `/usr/local/bin`, or `~/.mxcli` survives between
sessions. Everything is rebuilt from committed files:

```bash
bash scripts/setup-tools.sh
```

The script is idempotent (detect-then-install) and is wired to run automatically
via the `SessionStart` hook in `.claude/settings.json`, so a new session
re-establishes the toolchain before any work begins.

A cold run takes roughly 10–15 minutes, dominated by the ~1.2 GB MxBuild +
runtime download. Re-runs on a warm container finish in seconds.

### Script overrides

| Variable | Default | Effect |
| --- | --- | --- |
| `MENDIX_VERSION` | `11.12.1` | Mendix version to pre-cache |
| `MXCLI_REF` | `main` | branch/tag/SHA of `ako/mxcli` to build |
| `MXCLI_FORCE_REBUILD` | `0` | rebuild mxcli even when the installed binary is current |
| `SKIP_MENDIX_CACHE` | `0` | skip the MxBuild/runtime download (fast toolchain-only run) |

## Installed versions

Verified on Ubuntu 24.04.4 LTS (x86_64), 2026-07-29.

| Component | Version | Location |
| --- | --- | --- |
| **mxcli** | `ead8926` (built from source) | `/usr/local/bin/mxcli` |
| **MxBuild** | 11.12.1 | `~/.mxcli/mxbuild/11.12.1/modeler/mxbuild` |
| **`mx` validator** | 11.12.1 | `~/.mxcli/mxbuild/11.12.1/modeler/mx` |
| **Mendix runtime** | 11.12.1 | `~/.mxcli/runtime/11.12.1` |
| **ANTLR** | 4.13.1 (pinned) | `/opt/antlr/antlr-4.13.1-complete.jar`, shim at `/usr/local/bin/antlr4` |
| **Go** | go1.24.7 (`GOTOOLCHAIN=auto` fetches 1.26 per `go.mod`) | `/usr/local/go1.24.7` |
| **JDK** | OpenJDK 21.0.10 | system |
| **Node** | v22.22.2 | system |
| **PostgreSQL** | 16.13 (server) | `/usr/lib/postgresql/16/bin` |
| **Chromium** | Playwright build 1194 | `/opt/pw-browsers/chromium-1194` |

### Pinned mxcli commit

```
repo:   https://github.com/ako/mxcli
branch: main
commit: ead892672f82fdc5f54ed8a944e98026845700a2   (short: ead8926)
date:   2026-07-28T12:58:07-07:00
```

`scripts/setup-tools.sh` builds `main` HEAD by default so the toolchain tracks
upstream. To reproduce this exact build instead:

```bash
MXCLI_REF=ead892672f82fdc5f54ed8a944e98026845700a2 bash scripts/setup-tools.sh
```

### Why ANTLR is pinned

`make build` regenerates the MDL parser with whatever `antlr4` it finds on
`PATH`, and the generated Go must match the `github.com/antlr4-go/antlr/v4
v4.13.1` runtime that `go.mod` requires. `antlr4-tools` resolves to "latest" and
would silently drift the generated code out of sync, so a shim at
`/usr/local/bin/antlr4` pins the generator to the 4.13.1 jar.

Verified: after `make build` at `ead8926`, `git status` in the mxcli clone was
clean — the regenerated parser matches the committed source byte for byte.

## Build details

mxcli is built from source rather than installed from a release:

```bash
git clone --depth 1 --branch main https://github.com/ako/mxcli.git /opt/mxcli-src
cd /opt/mxcli-src
GOTOOLCHAIN=auto make build          # regen ANTLR parser -> sync embedded assets -> build bin/mxcli
install -m 0755 bin/mxcli /usr/local/bin/mxcli
```

`go.mod` declares `go 1.26.0` / `toolchain go1.26.5`. The image ships Go 1.24.7,
so `GOTOOLCHAIN=auto` must stay on — it downloads the 1.26 toolchain on demand.
Do not set `GOTOOLCHAIN=local`.

## Conventions

- **Model engine is `modelsdk`** (the default). Do **not** pass `--engine legacy`.
- The PostgreSQL server binaries are not on the default `PATH`; the setup script
  prepends `/usr/lib/postgresql/16/bin` and exports it via `$CLAUDE_ENV_FILE`.
  `mxcli run --local --ensure-db` needs them.
- Chromium comes from the base image (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
  Never run `playwright install`.
- Build outputs, local caches, and `*.mpr` files are gitignored. The mxcli clone,
  the ANTLR jar, and compiled binaries are **not** committed — they are rebuilt
  by the setup script.

## Scaffolding the Mendix project

Not done yet, and intentionally so. When the app is created, a single command
bootstraps the project, the AI tooling, and the devcontainer config:

```bash
mxcli new TimeRegistration --version 11.12.1
```

This runs `mx create-project` against the cached MxBuild, then `mxcli init`
(Claude Code skills + commands by default). Add `--output-dir .` to scaffold in
place rather than into `./TimeRegistration`.

Useful follow-ups once the project exists:

```bash
mxcli exec model.mdl -p TimeRegistration/TimeRegistration.mpr   # apply an MDL script
mxcli check model.mdl                                           # parse/validate MDL without executing
mxcli run --local --ensure-db -p .../TimeRegistration.mpr       # warm local dev loop + PostgreSQL
```

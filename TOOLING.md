# Toolchain

This repository is a Mendix-app development workspace driven by
[`mxcli`](https://github.com/ako/mxcli) and its MDL (Mendix Definition Language)
scripting layer.

The app it builds lives in `TimeRegistration/` — see **[APP.md](APP.md)**.
This document covers the toolchain only: what is installed, and how it
re-establishes itself in a fresh container.

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
| `MENDIX_VERSION` | `11.13.0` | Mendix version to pre-cache |
| `MXCLI_REF` | `main` | branch/tag/SHA of `ako/mxcli` to build |
| `MXCLI_FORCE_REBUILD` | `0` | rebuild mxcli even when the installed binary is current |
| `SKIP_MENDIX_CACHE` | `0` | skip the MxBuild/runtime download (fast toolchain-only run) |

## Installed versions

Verified on Ubuntu 24.04.4 LTS (x86_64), 2026-08-18.

| Component | Version | Location |
| --- | --- | --- |
| **mxcli** | `8fd0085` (built from source, pinned) | `/usr/local/bin/mxcli` |
| **MxBuild** | 11.13.0 | `~/.mxcli/mxbuild/11.13.0/modeler/mxbuild` |
| **`mx` validator** | 11.13.0 | `~/.mxcli/mxbuild/11.13.0/modeler/mx` |
| **Mendix runtime** | 11.13.0 | `~/.mxcli/runtime/11.13.0` |
| **ANTLR** | 4.13.1 (pinned) | `/opt/antlr/antlr-4.13.1-complete.jar`, shim at `/usr/local/bin/antlr4` |
| **Go** | go1.24.7 (`GOTOOLCHAIN=auto` fetches 1.26 per `go.mod`) | `/usr/local/go1.24.7` |
| **JDK** | OpenJDK 21.0.10 | system |
| **Node** | v22.22.2 | system |
| **PostgreSQL** | 16.13 (server) | `/usr/lib/postgresql/16/bin` |
| **Chromium** | Playwright build 1194 | `/opt/pw-browsers/chromium-1194` |

### Pinned mxcli commit

```
repo:   https://github.com/ako/mxcli
commit: 8fd0085834b2f424aff1baa6e5db3a5579b93cf6   (short: 8fd0085)
date:   2026-08-18
```

`scripts/setup-tools.sh` builds **this commit**, not `main`. It used to default
to the branch, which made the SHA recorded here decorative — a session built
whatever had landed that day, and one of them silently built a `main` that was
106 commits stale. Pass `MXCLI_REF=main` to follow the branch when retesting an
upstream fix.

Three things in this pin the app depends on:

- **PR 53** (`48548ca`, an earlier pin) — before it, mxcli wrote a workflow
  call-microflow activity the Mendix 11.12.1 runtime could not load, so
  `TimeReg.TimesheetApproval` built clean and then refused to start the app
  (finding 39).
- **PR 55** (`a91e732`) — `ALTER PAGE` no longer drops the attribute binding off
  a widget it writes (findings 49 and 55), and `dynamictext` content parameters
  take a `format` block, which is what lets the entry list render its own hours
  and dates instead of reading captions a microflow had to maintain.
- **`marketplace update`** (`8fd0085`) — the reason for this pin. `4a7bfd3` had
  no way to move a marketplace module to a newer version; finding 57 recorded
  that as a hole in the story, and this closes it. All seven modules were
  updated with it (see below).

The `4a7bfd3` pin also turned on `FormOrientation: Vertical` on the two entry
forms. Both have declared it since they were written; the modelsdk writer was
discarding it (#762), so the labels sat beside the fields rather than above them.

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
- The Mendix model (`TimeRegistration.mpr` + `mprcontents/`) **is** committed —
  it is the app, not build output. Build outputs (`deployment/`, `theme-cache/`,
  `.mendix-cache/`), the mxcli clone, the ANTLR jar and compiled binaries are
  **not** — they are rebuilt by the setup script.

## The Mendix project

The app lives in `TimeRegistration/` and was scaffolded with:

```bash
mxcli new TimeRegistration --version 11.12.1
```

### Upgraded to 11.13.0

mxcli has no upgrade command; the Mendix toolset does the migration, the same
way opening a project in a newer Studio Pro does:

```bash
mxcli setup mxbuild  --version 11.13.0
mxcli setup mxruntime --version 11.13.0
~/.mxcli/mxbuild/11.13.0/modeler/mx convert -p TimeRegistration
```

`mx convert` rewrites the `.mpr` in place and is **one-way** — 11.12.1 cannot
open the result. It reported 0 errors, and `mx check` agrees. The 111 warnings
and 1 deprecation it counted are the same ones the project carried on 11.12.1;
the deprecation is CW0700, the old string behaviour, which Mendix 12 removes.

Two things worth having checked, given finding 39. mxcli version-gates the class
name it writes for a workflow's call-microflow activity, and that gate still
lands `Workflows$CallMicroflowActivity` on 11.13.0 — re-running
`62-workflow.mdl` against the converted project produces a model the runtime
loads, which is exactly what failed before the gate existed. And the runtime
picks the matching version by itself:

```
Core: Using runtime version '11.13.0' for model version '11.13.0'
```

The regression suite passes unchanged: 136 assertions, 0 failures.

### Marketplace modules

All seven are at their current published versions. They were scaffolded by
`mxcli new` at whatever the 11.12.1 app template shipped, which by August 2026
was between one and six minor versions behind:

| Module | Content ID | Was | Now |
| --- | --- | --- | --- |
| Administration | 23513 | 4.3.2 | 4.5.0 |
| Atlas_Core | 117187 | 4.1.3 | 4.4.0 |
| Atlas_Web_Content | 117183 | 4.1.0 | 4.3.0 |
| DataWidgets | 116540 | 3.5.0 | 3.11.3 |
| FeedbackModule | 205506 | 4.0.2 | 5.0.0 |
| NanoflowCommons | 109515 | 6.0.0 | 7.2.1 |
| WebActions | 114337 | 2.11.0 | 2.11.2 |

Every marketplace command needs a Mendix Personal Access Token. mxcli reads
`MENDIX_PAT` from the environment before it looks in `~/.mxcli`'s credential
store, and this container has it set, so nothing needs `mxcli auth login`.

The shape of one update, with the two repairs that are not optional:

```bash
export MXCLI_NO_REF_CACHE=1                        # finding 58 — do not skip
mxcli marketplace diff   23513 -p TimeRegistration.mpr --to 4.5.0
mxcli marketplace update 23513 -p TimeRegistration.mpr --to 4.5.0
mxcli fix widgets            -p TimeRegistration.mpr   # CE0463
mxcli fix design-properties  -p TimeRegistration.mpr   # CE6087
~/.mxcli/mxbuild/11.13.0/modeler/mx check TimeRegistration.mpr
```

Four notes, each of which cost something to find:

- **`MXCLI_NO_REF_CACHE=1` is required, not tuning.** With the reference cache
  warm, `diff` reports JavaScript actions as locally modified when they are not,
  and `update` then refuses. Finding 58 has the two-run reproduction.
- **`fix widgets` is not optional.** It changed 23 units after DataWidgets and 26
  after Atlas_Web_Content; `mx check` is clean only because it ran.
- **Order matters.** Atlas_Web_Content bundles the DataWidgets widgets at 3.4.0.
  mxcli keeps the newer copies rather than rolling 3.11.3 back, and says so — but
  do not rely on that if you are updating with an older mxcli.
- **`--force` was needed for four of the seven**, for reasons unrelated to anyone
  editing anything (findings 59 and 60). Read what it says before passing it.

Verified after the sweep: `mx check` reports 0 errors, the app starts, and the
136-assertion suite passes. The Administration update was tested against a
populated database — 11 accounts, 10 employees, 29 time entries, all still there
afterwards with their associations intact.

See **[APP.md](APP.md)** for what it does. To run it:

```bash
cd TimeRegistration
./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch
```

`TimeRegistration/mxcli` is a hard link to the system binary and is gitignored;
`scripts/setup-tools.sh` re-creates `/usr/local/bin/mxcli` on a fresh container.
Re-link it after a rebuild with `ln -f /usr/local/bin/mxcli TimeRegistration/mxcli`
(or just call `mxcli` from PATH).

Everything in the app is reproducible from `TimeRegistration/mdlsource/`:

```bash
cd TimeRegistration
./mxcli check mdlsource/01-domain.mdl -p TimeRegistration.mpr --references  # validate
./mxcli exec  mdlsource/01-domain.mdl -p TimeRegistration.mpr               # apply
~/.mxcli/mxbuild/11.13.0/modeler/mx check TimeRegistration.mpr              # full build check
```

The scripts are numbered by feature (`0x` domain, `1x` seed, `2x` logic and
datasources, `3x` pages, `4x` navigation and settings, then one block per feature
with its security script last).

### Rebuilding the app from `mdlsource/`

```bash
mxcli new TimeRegistration --version 11.13.0
cp -r <repo>/TimeRegistration/mdlsource <repo>/TimeRegistration/theme TimeRegistration/
cd TimeRegistration
for pass in 1 2; do
  for f in mdlsource/*.mdl; do mxcli exec "$f" -p TimeRegistration.mpr; done
done
~/.mxcli/mxbuild/11.13.0/modeler/mx check TimeRegistration.mpr   # 0 errors
```

Verified end to end. Three things about it are not obvious:

- **Two passes are required.** The numbering is by feature, not by dependency,
  and there are forward references — `30-page-week.mdl` binds `ACT_WeekPrev`,
  which `73-week-actions.mdl` defines. A page cannot be written before the
  microflow it calls exists, so pass one leaves seven scripts failed; pass two
  resolves them and pass three changes nothing.
- **The logic and page scripts are re-runnable; the domain scripts are not.**
  `2x`–`8x` use `create or modify` / `create or replace` / `add attribute if not
  exists`. The domain scripts (`01`–`06`, `50`, `52`) use bare `create entity` /
  `create module role`, so a second pass stops at their first statement with
  "already exists". That is the guard working — the definitions are already
  there — but note that **`exec` halts at the failing statement**, so nothing
  later in such a file runs either. Do not put anything after a bare `create`.
- **A security script must follow the feature it secures.** Granting on an entity
  a later script creates fails on pass one, and on pass two the grant applies and
  is then destroyed when `create or modify entity` replaces the entity. The build
  sits at 2 errors forever. This is finding 63, and it is why the rate-card grants
  live in `84-security-rate.mdl` rather than at the end of `80-security-period.mdl`.

Until that was fixed the app could not be rebuilt from its own source at all,
while `mx check` on the committed `.mpr` reported 0 errors — the model was right
and the recipe for it was not.

# mxcli / MDL findings

Everything that bit, surprised, or needed a workaround while building the
TimeRegistration app with mxcli. Each entry has the command that produces it and
the output as printed.

**Environment**

| | |
|---|---|
| mxcli | `48548ca` — `ako/mxcli` `main` with PR 53 merged; the app depends on it (finding 39). Finding 55 was found later, on `0580ead`; PR 55 was retested on top of that, at `25b02ac` and again at `a91e732` |
| (built during the findings) | `ead8926` then `0ed0359` — everything below was found on those |
| (current pin) | `8fd0085` — moved here for `marketplace update`; findings 57–62 are on it |
| Mendix | 11.12.1 (MxBuild + runtime) — every finding below was reproduced on it; the app has since moved to 11.13.0 |
| Engine | `modelsdk` (default) |
| Platform | Ubuntu 24.04.4, Go 1.24.7 with `GOTOOLCHAIN=auto`, JDK 21.0.10, ANTLR 4.13.1 |

Commands below run from `TimeRegistration/`. Reproductions were re-run against
the finished project unless marked *(captured during the build)*.

Legend: **[bug]** mxcli defect · **[gap]** `mxcli check` passes what MxBuild
rejects · **[platform]** a Mendix rule mxcli reports correctly · **[mine]** my own
mistake, recorded so the next person doesn't repeat it · **[closed]** fixed
upstream, kept for the history.

---

## Retest against ako/mxcli PR 55

PR 55 takes the five findings left open by the editing work. Built from source
and re-run against the reproductions below, on this project — first at `25b02ac`,
then again after the PR picked up `a91e732`.

| # | Status | Notes |
|---|---|---|
| 51 `create association` on re-run | *message only* | still an error, which the PR argues is correct SQL-shaped semantics; it now names the way out |
| 52's MDL045 (`div` by an association path) | **fixed** | `round($hours div $Matter/BudgetHours * 100)` passes |
| 53 MDL048 (`[id = '[%CurrentUser%]']`) | **fixed** | and a literal stored id is still rejected, which is the half worth keeping |
| 54 `describe` drops `set task outcome` | **fixed** | the round-trip is safe again |
| 55 `alter page` drops attribute bindings | **fixed** | association and database sources at `25b02ac`, microflow sources at `a91e732`; `ALTER PAGE` is usable for data-bound widgets again |

### The four that are done

MDL045 and MDL048 were the two rules that cried wolf, and both now pass the lines
they used to reject:

```
$ ./mxcli check mdlsource/60-workflow-support.mdl -p TimeRegistration.mpr      # main
  ✗ retrieve '$me' constrains the object id against a value (`[id = '[%CurrentUser%]']`) … [MDL048]
  1 issues: 1 errors, 0 warnings, 0 info

$ /tmp/mxcli-pr55 check mdlsource/60-workflow-support.mdl -p TimeRegistration.mpr
  ✓ Syntax OK (6 statements)
  Check passed!
```

MDL048 keeps the case that is genuinely wrong — `where [id = '7881299347898368']`
is still an error — so the rule was narrowed rather than removed.

Finding 54's round-trip is whole again. `ACT_ApproveFromTask` is four statements
and describe showed three:

```
$ /tmp/mxcli-pr55 -p TimeRegistration.mpr -c 'describe microflow "TimeReg"."ACT_ApproveFromTask"'
  $claimed = call microflow TimeReg.ACT_ClaimTask(Task = $task) on error rollback;
  set task outcome $task 'Approve';          <- was `-- Empty action`
  show page TimeReg.MyTasks;
```

Finding 51 is a message, not a behaviour change, and the message is the right
fix — the idempotent form existed all along and nothing pointed at it:

```
main:  Error: association already exists: TimeReg.Employee_Role
PR 55: Error: association 'TimeReg.Employee_Role' already exists — use
       'create or modify association ...' to update it in place, or
       'drop association TimeReg.Employee_Role' first
```

### 55 took two rounds, and the second one finished it

The first commit fixed the association source. Five probes — one per kind of
enclosing datasource, each an `insert after` a sibling in the same context —
showed what was left:

| Enclosing widget | DataSource | at `25b02ac` | at `a91e732` |
|---|---|---|---|
| `listview weekGrid` | microflow `DS_WeekRows` | `<unbound>` | `RowTotal` ✓ |
| `dataview weekTotals` | microflow `DS_WeekTotals` | `<unbound>` | `GrandTotal` ✓ |
| `listview compoList` | association `WeekComposition_Timesheet` | `HoursLabel` ✓ | ✓ |
| `listview eeRules` | `database from EntryRule` | `Description` ✓ | ✓ |
| `dataview eeForm` | page parameter `$Entry` | `HoursLabel` ✓ | ✓ |

At `25b02ac` that was two `mx check` errors — `[CE0402] "No value specified." at
Text 'pMfList'` and the same for `pMfView`. At `a91e732`, 0 errors. The split was
never ListView-versus-DataView or `insert`-versus-`replace`: `replace weekStatus`
in the root DataView on `DS_CurrentTimesheet` failed the same way and now works,
which is finding 49's original reproduction, closed at last.

**Nesting resolves to the nearest source, and says so when it is wrong.**
`compoList` is an association-sourced list inside a microflow-sourced DataView.
Inserting `RecordedLabel` — a `Timesheet` attribute, from the *outer* source —
resolves against the inner entity and MxBuild names it:

```
[error] [CE1613] "The selected attribute 'TimeReg.WeekComposition.RecordedLabel'
        no longer exists." at Text 'pShadow'
```

That is the correct rejection, and the qualified name in it is what makes it
diagnosable.

**The end-to-end test: rebuilding the change finding 55 was written from.** The
"Entries this week" panel had to go into the page's own source file and be
re-issued as a whole `create or replace page`. Dropped and re-added through
`ALTER PAGE INSERT` — a ListView on a microflow datasource, with an
`EntryDateLabel` binding, association-path `ContentParams`
(`TimeEntry_Matter/Name`, `TimeEntry_TaskCode/Code`) and a parameterised
`show_page`:

```
$ /tmp/mxcli-pr55b exec -p TimeRegistration.mpr /tmp/pr55/real.mdl
Altered page TimeReg.WeekTimesheet
Altered page TimeReg.WeekTimesheet

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
The app contains: 0 errors.

$ diff <(describe page … before) <(describe page … after)
(no output)
```

The page built by `ALTER PAGE` is indistinguishable from the one built by
`create or replace page`. The workaround in finding 49 is no longer needed.

### 56. `describe page` omits a page action's arguments **[bug]**

Found while checking that the rebuilt panel above was really equivalent. The
week screen's Edit button opens a parameterised page, and describe prints the
target without the argument:

```
$ ./mxcli -p TimeRegistration.mpr -c 'describe page "TimeReg"."WeekTimesheet"' | grep -A1 weEdit
              actionbutton weEdit (
                Action: show_page TimeReg.EditEntry,
```

The source says `show_page "TimeReg"."EditEntry"($Entry = $currentObject)`. Same
shape as finding 54 and finding 42 — the write path takes it, the read path drops
it — and the same hazard, since `describe → exec` is the documented way to
regenerate a document.

**In practice it survives, because the argument is inferred.** Re-executing the
describe output produces a page that passes `mx check` with 0 errors, and a
deliberate negative confirms MxBuild would have caught a genuinely missing one:

```
-- weekAddRow sits in the header, where the context is Timesheet: nothing to infer
[error] [CE1571] "No argument has been selected for parameter 'Entry' and no
        default is available." at Action button 'weekAddRow'

-- the same bare form inside the entries ListView, where $currentObject is a
-- TimeEntry, checks clean
The app contains: 0 errors.
```

So a bare `show_page` binds `$currentObject` when the context entity matches the
page parameter. That is convenient, and it is why the round-trip is safe here —
but it is inference, not preservation, and it would not save an argument that
was anything other than the enclosing object.

### 57. A marketplace module could not be upgraded through the CLI — now it can **[closed]**

Recorded on `4a7bfd3` as a hole in the story, and closed by `8fd0085`. Kept
because half of what it said was my own error, and that is worth keeping visible.

**What it said, and what was wrong with it.** I reported two independent blocks.
The second was real: on `4a7bfd3` there was no update path. `marketplace install`
refused an in-place module update by design —

> Updating a module that is already present is NOT done automatically: it could
> discard local edits and, for modules with persistent entities, change entity
> IDs (which loses data). Such updates are reported and left to Studio Pro.

— and the Mendix toolset had no upgrade either: `mx` 11.13.0 offers
`module-import`, `show-module-version`, `set-module-version`,
`create-module-package`, `merge`, `diff`, and nothing else.

The first block was **not real, and it was mine**. I wrote that no Mendix PAT was
available, on this evidence:

```
$ ./mxcli marketplace versions 107249
auth: no credential for profile "default". Run: mxcli auth login --profile default
```

That is the credential *store* being empty. It is not the same question as
"is there a credential", because `internal/auth/resolver.go` checks the
environment first and env vars take precedence over the store:

```go
const (
	EnvPAT     = "MENDIX_PAT"
	EnvProfile = "MXCLI_PROFILE"
)
```

`MENDIX_PAT` was set in this container the whole time. One `env | grep -i mendix`
would have shown it. I took a single command's error message for the state of the
world, and reported "cannot be done" to the user on the strength of it. The
content ID in that command was also wrong (107249 is not Administration; 23513
is), so the command would not have proved anything either way — it printed the
auth error before it ever got to the ID.

**What the seven modules did.** With `8fd0085` built and the PAT read from the
environment, all seven updated to their current versions and the app still passes
its 136 assertions:

| Module | Was | Now | `update` reported |
|---|---|---|---|
| Administration | 4.3.2 | 4.5.0 | 28 units, **9 element identities preserved**, 3 role grants restored |
| Atlas_Core | 4.1.3 | 4.4.0 | 51 units, 3 role grants restored (needed `--force`, see 59) |
| Atlas_Web_Content | 4.1.0 | 4.3.0 | needed `--force`; kept 5 newer widgets (see below) |
| DataWidgets | 3.5.0 | 3.11.3 | 11 units, 3 role grants restored |
| FeedbackModule | 4.0.2 | 5.0.0 | needed `--force`, see 59 |
| NanoflowCommons | 6.0.0 | 7.2.1 | 59 units, 12 identities preserved — needed `--no-baseline`, see 60 |
| WebActions | 2.11.0 | 2.11.2 | 14 units |

**The data-loss claim is the one worth testing, so I tested it.** The old finding
argued the refusal was right *for this app in particular*, because
`Administration` carries the persistent entities and the identity model hangs off
`Administration.Account` through `Employee_Account`. So: seeded the database with
the app running on Administration 4.3.2, stopped it, updated to 4.5.0, and
restarted against **the same database** without dropping it.

```
before          after
administration$account       11    11
timereg$employee             10    10
timereg$timesheet            10    10
timereg$timeentry            29    29
system$user                  11    11
employees still linked to an account: 10
```

Nothing was dropped, and `TimeReg.Employee_Account` still points at
`Administration.Account`. The identity transplant does what it claims.

**Two things the update does that are not obvious from the name.**

`mxcli fix widgets` after each update is not optional. It is printed as a
suggestion — "repair what a headless update leaves behind (expected, not a
fault)" — but on DataWidgets it changed **23 units**, and `mx check` is only clean
because it ran. Same for `fix design-properties`: Atlas_Core 4.4.0 renamed two
design properties, and it rewrote the two documents using them.

Bundled widgets are version-aware, which matters for update *order*.
Atlas_Web_Content 4.3.0 ships the DataWidgets widgets at 3.4.0, and had it been
updated after DataWidgets naively it would have rolled 3.11.3 back:

```
  Kept 5 newer widget(s) the package would have rolled back:
    widgets/com.mendix.widget.web.Datagrid.mpk — kept 3.11.3, package ships 3.4.0
    ...
```

**What is left.** `marketplace update` moved this project from "buildable but not
maintainable" to maintainable. Findings 58–62 are what it cost to get there.

---

### 58. `marketplace diff` gives opposite answers on two identical runs **[bug]**

The command exists to answer one question — *has anyone edited this module?* — and
it answers it differently depending on whether a cache is warm. Same command, run
twice, nothing touched in between:

```
$ rm -rf ~/.mxcli/marketplace-refs/ref/11.13.0_7b3e3f82-… ~/.mxcli/marketplace-refs/ref/11.13.0_f35c23c0-…
$ mxcli marketplace diff 114337 -p TimeRegistration.mpr --module WebActions
  No local modifications: 9 of 9 elements verified unchanged.

$ mxcli marketplace diff 114337 -p TimeRegistration.mpr --module WebActions
  Locally modified (8 of 9 elements):
    changed   JAVASCRIPT_ACTION FocusNext
    changed   JAVASCRIPT_ACTION FocusPrevious
    changed   JAVASCRIPT_ACTION ReadCookie
    changed   JAVASCRIPT_ACTION ScrollTo
    changed   JAVASCRIPT_ACTION SetCookie
    changed   JAVASCRIPT_ACTION SetFavicon
    changed   JAVASCRIPT_ACTION SetFocus
    changed   JAVASCRIPT_ACTION TakePicture
```

The first is right; the second is a false positive. mxcli ships the bisect switch
for exactly this, and it agrees:

```
$ MXCLI_NO_REF_CACHE=1 mxcli marketplace diff 114337 -p TimeRegistration.mpr --module WebActions
  No local modifications: 9 of 9 elements verified unchanged.
```

**Root cause, and it is written down in the source.** A cached reference stores
the model file alone. `cmd/mxcli/marketplace/refcache.go`, on `isModelFile`:

```
//	PackageRef.mpr      14 MB   read
//	widgets/           9.6 MB   never read
//	themesource/       6.4 MB   never read
//	theme-cache/       2.1 MB   never read (compiled CSS)
//	javascriptsource/  1.6 MB   never read
```

`javascriptsource/` is not "never read" — it is where a JavaScript action's body
lives, and comparing one needs it. So on a cache hit every JS action in the module
differs from a reference that no longer has any JS in it. The 8 that flip are
exactly the 8 `JAVASCRIPT_ACTION`s; the 9th element, which is not one, stays
unchanged either way. A module of nothing but JS actions would report 100 %
locally modified on the second run.

The consequence is not cosmetic — `update` shares the check and refuses:

```
refusing to update: 8 element(s) have been changed locally and the update would discard them:
    JAVASCRIPT_ACTION FocusNext
    ...
  - Save them first:  --save-edits <dir>
  - Then update:      --force
```

The advice that follows is worse than the refusal. A user who takes it reaches for
`--force` — the flag whose whole job is *discard local edits I have been told
about* — to get past edits that do not exist. The one time the tool is wrong about
edits is the time it tells you to override the protection.

There is a second, quieter symptom: passing `--to` changes the answer to the
question `--to` has nothing to do with.

```
$ mxcli marketplace diff 114337 -p … --module WebActions --to 2.11.0
  Locally modified (8 of 9 elements): …
  Upgrading to 2.11.0 would touch 0 element(s), none of which you have modified.
```

Installed 2.11.0, target 2.11.0. Read together: *eight elements differ from
2.11.0, and installing 2.11.0 would change none of them.* Both halves cannot be
true.

**Workaround:** `MXCLI_NO_REF_CACHE=1` on every `diff` and `update`. Every module
in finding 57 was updated with it set. The cost is real — a reference is a
`mx create-project` plus a `mx module-import` plus a download, and the cache is
there because that is ~67 s per module — but a fast wrong answer to "has anyone
edited this?" is worth nothing.

---

### 59. A module nobody has ever opened reports local modifications **[platform]**

`FeedbackModule` came back with three edited pages. I have never opened it:

```
$ MXCLI_NO_REF_CACHE=1 mxcli marketplace diff 205506 -p TimeRegistration.mpr --module FeedbackModule
  Locally modified (3 of 51 elements):
    changed   PAGE PopupFailure
    changed   PAGE PopupSuccess
    changed   PAGE ShareFeedback
```

Not the cache from finding 58 — this survives `MXCLI_NO_REF_CACHE=1`. `--save-edits`
writes the three out, and they are ordinary untouched Atlas pages; there is nothing
in them that looks like anyone's work.

So I scaffolded a brand-new app and asked it the same question:

```
$ mxcli new Pristine --version 11.13.0
$ MXCLI_NO_REF_CACHE=1 mxcli marketplace diff 205506 -p Pristine.mpr --module FeedbackModule
FeedbackModule — installed 4.0.2 (Mendix 11.13.0)

  Locally modified (3 of 51 elements):
    changed   PAGE PopupFailure
    changed   PAGE PopupSuccess
    changed   PAGE ShareFeedback
```

A project that is four minutes old and has never been opened reports three locally
modified pages. The premise underneath `diff` — that a module installed at version
X is byte-identical to the published package for X — does not hold for modules
that arrive inside Mendix's own app template. The template's copy of
FeedbackModule 4.0.2 is simply not the marketplace's copy of FeedbackModule 4.0.2.

This is Mendix's doing rather than mxcli's, but it lands on mxcli's users: every
scaffolded app starts life with phantom edits, and the only way through is
`--force`, which is indistinguishable from the way you get through real ones.
Atlas_Core has the same shape in a milder form — one element (`SNIPPET
FeedbackWidget`) that cannot be described at all, which is enough to make it
refuse:

```
1 element(s) could not be read, so it cannot be shown that the module is unedited.
Re-run with --force to update anyway
```

That refusal is the honest one — *we could not tell* and *nothing changed* are
different answers, and the tool says so rather than guessing. It just means four
of the seven modules here needed `--force` for reasons that have nothing to do
with anyone editing anything.

---

### 60. The baseline for "has anyone edited this?" can be unpublished **[platform]**

`NanoflowCommons` shipped in the template at 6.0.0. The 6.x line on the
marketplace now starts at 6.3.0 — 6.0.0 has been withdrawn — so the version the
check needs to download is the one version that cannot be downloaded:

```
$ mxcli marketplace update 109515 -p TimeRegistration.mpr --module NanoflowCommons --to 7.2.1
version "6.0.0" not found; run 'mxcli marketplace versions <id>' to list available versions
  The installed version is the baseline for "has anyone edited this?", so it has to be
  downloadable. It is not, and --force does not help: there is nothing to compare against.
  hint: re-run with --no-baseline to update without that check (local edits are lost silently)
```

The error is exact and the hint is the right one, so this is a limit rather than a
defect — but note where it falls. The module furthest behind (6.0.0 → 7.2.1, a
major version) is the one whose safety check cannot run at all, and `--force` is
explicitly no help. The diagnosis is worth reading twice: `--force` overrides *we
found edits*, and this is *we cannot look*.

I satisfied it another way. The app is reproducible from `mdlsource/`, so "did we
edit NanoflowCommons" is answerable by grep:

```
$ grep -ril nanoflowcommons TimeRegistration/mdlsource/
TimeRegistration/mdlsource/52-security-roles.mdl
```

— and all three hits are `NanoflowCommons.User` in user-role grants, which live in
the project's security document, not in the module. Then `--no-baseline`, and the
update restored those three grants by itself.

---

### 61. A Mendix project's `widgets/` are inputs, and `*.mpk` looks like build output **[mine]**

Found while committing the marketplace sweep: `git status` had nothing to say
about `widgets/`, even though `marketplace update` had just replaced 1 374 files
under it. The root `.gitignore` had this, under a heading reading *Build
artifacts*:

```
*.mpk
*.mda
```

`.mpk` is Mendix's package extension, so that rule reads as "ignore downloaded
marketplace packages", which is right — and it also silently swallows
`TimeRegistration/widgets/*.mpk`, which are not downloads but the project's own
pluggable widgets. Nothing regenerates them: they arrive with `mxcli new` or a
`marketplace update` and are read at build time.

The repo had therefore never been buildable from a clone. Testing it is one
command, and I should have run it long before this:

```
$ git clone -q <repo> /tmp/fresh
$ mx check /tmp/fresh/TimeRegistration/TimeRegistration.mpr
[error] [CE0462] "Could not find widget 'Combo box' in the 'widgets' directory. …" at Combo box 'eeMatter'
[error] [CE0462] "Could not find widget 'Combo box' in the 'widgets' directory. …" at Combo box 'eeTask'
[error] [CE0462] "Could not find widget 'Combo box' in the 'widgets' directory. …" at Combo box 'eeBillability'
The app contains: 134 errors.
```

Every session so far worked on a container where `widgets/` already existed —
`mxcli new` put it there in session 1 and nothing removed it — so the app built
every time and the gap never showed. TOOLING.md has claimed since session 1 that
the model "**is** committed — it is the app, not build output". It was half
committed.

Fixed by un-ignoring the directory (33 files, 12 MB):

```gitignore
*.mpk
!TimeRegistration/widgets/
!TimeRegistration/widgets/**/*.mpk
```

The lesson is about what "reproducible" is worth unverified. A setup script that
passes on the machine that has been running all along proves only that the
machine has not changed. Clone into an empty directory and check.

---

### 62. Updating Atlas puts a feedback widget on every page, and MDL cannot take it off **[platform]**

Atlas_Core 4.4.0 adds a Sprintr feedback widget to `Atlas_Default`. All 22 pages
in this app use that layout, so the upgrade hung a floating **Feedback** tab down
the right-hand edge of every screen in a law firm's timesheet. It is visible in a
screenshot diff against `docs/screenshots/02-week-timesheet.png` and in nothing
else — no assertion in the 136 caught it, and `mx check` reports 0 errors.

```
$ # the element, found by walking up from the text
button.mxfeedback-start-button.mx-name-feedback1.mxfeedback-start-button--side
  < div.mx-scrollcontainer-center.region-content
  …
```

The obvious fix is to remove the widget from the layout, and that is the one thing
MDL will not do:

```
$ mxcli describe layout Atlas_Core.Atlas_Default -p TimeRegistration.mpr
-- Layout Type: Responsive
-- This is a layout document. Layouts define the structure that pages are built upon.
-- Layouts cannot be created via MDL; they must be created in Studio Pro.
```

Editing Atlas_Core directly would also be undone by the next `marketplace update`,
and would make this module report a real local edit forever after. So it is hidden
from the app's own stylesheet instead — `theme/web/_vdh.scss`:

```scss
.mxfeedback-start-button { display: none !important; }
```

The general point is the one to keep: a marketplace update can change what every
page *renders* without changing anything the model validator or a DOM-content
assertion can see. Upgrading a theme module is a visual change, and the only thing
that catches it is looking.

---

### 63. The app could not be rebuilt from its own source **[mine]**

`APP.md` has said since session 1 that the whole app "is defined by the scripts in
`TimeRegistration/mdlsource/`, so it can be rebuilt from source", and TOOLING.md
that the scripts "are re-runnable". Testing that — scaffold an empty 11.13.0 app,
copy `mdlsource/` in, run all 62 scripts in order — produces a project that does
not build:

```
[error] [CE2729] "No access to entity 'TimeReg.RateCardCaption' for user role 'Administrator'." at Data view 'rkCaption'
[error] [CE2729] "No read access to attribute 'Label' in entity 'TimeReg.RateCardCaption' …" at Text 'rkEffective'
The app contains: 2 errors.
```

**The cause is an ordering mistake of mine, doubled by a property of `exec`.**
`80-security-period.mdl` ended with the rate-card block, which grants on
`TimeReg.RateCardCaption` — an entity `81-domain-rate.mdl` creates. So on a cold
first pass the grant hits an entity that does not exist yet, and because **`exec`
halts at the failing statement**, the rest of that file never runs either:

```
!! 80-security-period.mdl: Error: entity not found: TimeReg.RateCardCaption
```

A second pass looks like it should fix it, and does not, which is the part worth
keeping. On pass two the names all resolve and the grants apply — and then `81`
runs again in the same pass, where `create or modify entity` **replaces**
RateCardCaption and takes its access rules with it. The build is therefore stable
at 2 errors no matter how many times it is run: pass three, pass four, identical.

**Why it stayed hidden for the whole engagement.** The committed `.mpr` is
correct, because it was never cold-built — it grew incrementally across sessions,
and in the session where the rate card was added, `81` had already run before
`80` was written. Every check since has been run against that `.mpr`, where the
grants are present and `mx check` reports 0 errors. Nothing in the repo ever
executed the claim.

Fixed by moving the block into `84-security-rate.mdl`, after the feature it
secures — which is what `75-security-week.mdl` and `88-security-editing.mdl`
already do. Verified the way the claim should have been verified all along:

```
$ mxcli new TimeRegistration --version 11.13.0     # empty project
$ for f in mdlsource/*.mdl; do mxcli exec "$f" -p TimeRegistration.mpr; done   # twice
$ mx check TimeRegistration.mpr
The app contains: 0 errors.
```

Two passes are needed, and that is not the ordering bug — it is forward
references between scripts (`30-page-week.mdl` binds `ACT_WeekPrev`, defined in
`73-week-actions.mdl`). A page cannot be written before the microflow it calls
exists, so a single pass through a numbered-by-feature layout cannot work. The
second pass converges and a third changes nothing.

**One claim in TOOLING.md is still wrong and is left wrong deliberately.** The
domain scripts use bare `create entity` / `create module role`, not
`create or modify`, so on a re-run they fail at their first statement:

```
!! 01-domain.mdl: Error: enumeration already exists: TimeReg.ENUM_Billability
!! 02-domain-reporting.mdl: Error: entity already exists: TimeReg.PeriodStat
!! 52-security-roles.mdl: Error: module role already exists: TimeReg.FeeEarner
```

That is harmless on a rebuild — the definitions are already there and the failure
is the guard doing its job — but it means "the scripts are re-runnable" is true of
the logic and page scripts and false of the domain ones. Changing them to
`create entity if not exists` would make the sentence true; changing the sentence
is the smaller edit and does not risk `create or modify entity` silently dropping
an attribute a statement omits. TOOLING.md now says which is which.

The lesson is the same one as finding 61, one level up: **a claim about
reproducibility that nothing executes is decoration.** Both were found by running
the claim rather than reading it.

---

### 64. Upstream survey at `e6a83b5d` — four new rules, one behaviour change **[survey]**

3,922 commits and three releases (0.19, 0.20, 0.21) after the `8fd0085` pin.
Built from source and run against this project's 62 scripts. **Zero errors on
both binaries**; the new one adds 14 findings, in four rules:

| Rule | Hits | Verdict here |
|---|---|---|
| MDL067 | 27 | behaviour change, inert for this app — see below |
| MDL077 | 19 | true, and deliberately not acted on |
| MDL071 | 2 | not applicable — no view entities |
| MDL-WORKFLOW10 | 2 | false positive |

**MDL067 is the one that matters, and it is not a diagnostic.** The default for a
bare `commit $X;` changed:

```
ℹ 7 commit activities use the default, which is now WITH EVENTS to match Studio Pro
  (#895); before this release a bare `commit $X;` wrote events OFF
```

78 commit statements here were written under the old default and are stored with
events off. Re-running the scripts on the new binary flips them on. That is inert
in this app — the only `Event*` names in `mdlsource/` are our own `AuditEntry`
attributes, and neither `TimeReg` nor `Administration.Account` declares an event
handler — but it is a silent semantic change to 27 microflows, and an app with
before/after-commit handlers would find its seed data behaving differently after a
rebuild that reported nothing. Worth spelling the intent out (`commit $X without
events;`) in any project where handlers exist.

**MDL077** reports all 19 navigation items as having no icon, correctly:
Mendix's sidebar collapses to an icon rail and an item without one shows a few
characters of its caption. Not acted on because the design handoff's sidebar is
text-only and this app ships its own sidebar styling; adding icons would be
changing the design to satisfy a linter. Recorded rather than suppressed.

**MDL071** flags `Year` on `Period` and `Timesheet` as an OQL reserved word. The
rule's own advice says the problem is confined to a view entity's own attribute,
whose name is its select alias — this app has no view entities, so there is
nothing to do.

**MDL-WORKFLOW10 is wrong here, and says so itself.** It reports that
`ACT_ApproveFromTask` and `ACT_ReturnFromTask` complete a user task without
assigning it first, which would fail at runtime with *"You can't complete this
user task, it is not assigned to you"*. Both call `ACT_ClaimTask` on the line
before, which does exactly what the rule asks for:

```mdl
$claimed = call microflow "TimeReg"."ACT_ClaimTask" ("Task" = $task);
set task outcome $task 'Approve';
```

The rule does not follow a call, and its advice ends *"Ignore this if the task is
claimed elsewhere — in a microflow this one calls."* That is the honest way to
ship a rule that cannot see the whole picture, and it is worth contrasting with
finding 58, where the tool is confidently wrong instead.

**Finding 58 is not fixed.** No commit has touched
`cmd/mxcli/marketplace/refcache.go` since the pin, and `javascriptsource/ never
read` is still in `isModelFile`'s table. `MXCLI_NO_REF_CACHE=1` remains required
for any `marketplace diff` or `update`.

**Nothing in the release notes required action here.** The larger fixes are for
constructs this app does not use: `update security` (never used), `SIGN_OUT` /
`OPEN_LINK` (no sign-out button), image widgets (none), message definition
collections, SOAP mappings, Reduce folds. The documentation-preservation fix
(#1018 — `create or replace` writing an empty documentation field over a stored
one) would have mattered, except all 62 scripts already carry `/** … */` comments,
so there was nothing to overwrite.

---

## Retest against ako/mxcli PR 53

PR 53 sets out to fix eighteen of these. Built from source and re-run against the
reproductions below, on a scratch copy of this project — first at `68acf0e`, then
again after the PR picked up `1b390dc`.

| # | Status | Notes |
|---|---|---|
| 2 `V3` identifier | **fixed** | parses |
| 3 quoted index name | **fixed** | parses |
| 4 `alter entity … add <attr>` | *docs only* | parser still rejects the shorthand; the docs now say `ADD ATTRIBUTE` |
| 5 role-name quoting | **fixed** | `describe user role` takes quoted and bare |
| 6 bad language code | **fixed** | now a clear error, and the model is left alone |
| 13 quoted `sort by` | **fixed** | normalised to the bare dotted form on write |
| 14 `association $currentObject/…` | **fixed** | parses |
| 15 duplicate widget names | **fixed** | `--references` catches it and names CE0495 |
| 17 aggregate inside `create` | **fixed** | new MDL044, with the workaround in the message |
| 23 `create microflow` idempotency | *partial* | still an error; the message now says "use create or modify" |
| 36 SEC005 hint | **fixed** | the rule now points at Studio Pro and says strict mode is not settable via MDL. Round 1 said "not fixed" — that judged the rule already installed in the project; `mxcli init` is what refreshes `.claude/lint-rules/`, and the corrected rule came with it |
| 39 workflow call-microflow class | **fixed** | needed a second commit; end-to-end proof below |
| 40 unmapped workflow parameter | **fixed** | `--references` catches it |
| 41 qualified `with(…)` corrupts the model | **fixed** | normalised to the bare name; no more unloadable `.mpr` |
| 42 `describe workflow` round-trip | **fixed** | emits `with (Timesheet = '$workflowContext')` |
| 47 System-module enumerations | *docs only* | `describe enumeration System.X` still can't see them; `system-module.md` now lists them and explains why |
| 48 `set task outcome` undocumented | **fixed** | documented in `write-workflows.md`, with the empty-outcome-branch pattern |
| 51 `create association` | *half* | the cascade is fixed — a member ref to a missing association is now rejected at exec, so the project can no longer be corrupted. Plain `create association` still errors on re-run |

### 39 is fixed, and it uncovered the next layer

The storage name is right now — the PR version-gates it, and `Workflows$CallMicroflowActivity`
is what lands in the unit:

```
$ f=$(grep -rl WF_ProbeBoot mprcontents | head -1); strings "$f" | grep -o 'Workflows\$CallMicroflow[A-Za-z]*'
Workflows$CallMicroflowActivity
```

and the runtime, which used to refuse the whole model, now loads it:

```
$ ./mxcli run --local -p TimeRegistration.mpr --ensure-db
Runtime started; app serving at http://127.0.0.1:8080/

$ grep -c "No new model classes" .mxcli/runtime.log
0
```

**But MxBuild now rejects what it used to accept.** The same workflow that built
with 0 errors on `main` fails on the PR:

```mdl
call microflow TimeReg.ACT_ApproveWeek with (Timesheet = '$workflowContext');
```
```
main (0ed0359):  The app contains: 0 errors.
PR 53 (68acf0e): [error] [CE0117] "Error(s) in expression." at Call microflow 'ACT_ApproveWeek'
                 [error] [CE6686] "The current outcomes of the call microflow activity do not
                                   match the configured microflow. Regenerate the outcomes."
                 The app contains: 2 errors.
```

Two separate causes, isolated by varying one thing at a time:

- **CE0117 is the parameter mapping.** A call to a microflow with no parameters
  produces no CE0117; add a parameter and it appears. The stored mapping says
  why — the value is written as a `Microflows$StringTemplate`, which is not what
  an entity-typed argument should be:

  ```
  $ strings "$unit" | grep -iE "workflowContext|StringTemplate"
  WorkflowContext
  Microflows$StringTemplate
  ```

- **CE6686 is the outcomes.** A call to a *void* microflow has no CE6686; a
  Boolean-returning one does. mxcli always writes a `Workflows$VoidConditionOutcome`,
  which was right for the old class and is not right for the new one — a Boolean
  or enumeration return needs matching outcomes.

  (Related and correct: calling a microflow that returns an *entity* is now
  properly rejected with CE6678.)

So the only shape that builds clean today is a call to a **void, no-parameter**
microflow — which is the one that cannot do an approval's work. Before the PR
the natural shape built and would not run; after it, it runs and will not build.

### Round 2 — `1b390dc` closes it

The PR picked up one further commit, *"match call-microflow outcomes to return
type + normalize context var"*. Rebuilt (`nightly-45-g1b390dc`) and re-ran the
same case:

```
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
The app contains: 0 errors.

$ strings "$unit" | grep -oE 'Workflows\$[A-Za-z]*Outcome'
Workflows$BooleanConditionOutcome        # was VoidConditionOutcome
```

Both errors are gone: the outcome type now follows the called microflow's return
type, and the context variable normalisation clears CE0117.

**Verified end to end, not just built.** The scratch copy was switched back to
the shape finding 39 said was unusable — the outcome branches do the work:

```mdl
outcomes
  'Approve' { call microflow TimeReg.ACT_ApproveWeek with (Timesheet = '$workflowContext'); }
  'Return'  { call microflow TimeReg.ACT_ReturnWeek  with (Timesheet = '$workflowContext'); };
```

and the task page's buttons were cut back to claim + `set task outcome`, so they
can no longer change anything themselves. Approving Fatima El Amrani's week from
the partner's inbox:

```
$ psql … -c "select eventlabel, description from timereg\$auditentry where eventtime > '2026-07-29'"
 29 Jul 17:52 | Week approved by the supervising partner

$ psql … -c "select e.fullname, t.statuslabel from timereg\$timesheet t … where t.timereg\$timesheet_workflow is not null"
 Pieter Ravensbergen | submitted
 Fatima El Amrani    | approved

$ psql … -c "select state, count(*) from system\$workflow group by state"
 InProgress | 1
 Completed  | 1
```

The status change and the audit row are written by `ACT_ApproveWeek`, and the
only thing that calls it is the workflow's own outcome branch. Finding 39 is
closed.

**The app now uses the natural shape.** PR 53 merged as `48548ca`:

```
$ git merge-base --is-ancestor 1b390dc origin/main; echo $?
0
```

so `scripts/setup-tools.sh`, which builds from `main` HEAD, produces a toolchain
that writes the workflow correctly. `62-workflow.mdl` has its outcome bodies
back, and `ACT_ApproveFromTask` / `ACT_ReturnFromTask` are down to claim +
`set task outcome`. The workaround is gone from the app; the finding stays here
because the trap it describes — build clean, refuse to load — is the kind worth
remembering.

### Round 2 — the skills caught up too

`mxcli init` refreshes `.ai-context/skills/`, and two files gained exactly what
findings 47, 48 and 51 had to be discovered the hard way:

- `write-workflows.md` now documents `set task outcome`, `open user task`,
  `notify workflow` and `workflow operation …`, states that there is no
  `complete task`, describes the empty-outcome-branch pattern, and explains that
  System-module **enumerations** are not in the `.mpr` so `describe enumeration
  System.X` returns nothing.
- `generate-domain-model.md` now says plain `create association` is not
  idempotent, and — the part that cost the most — that the error "aborts the rest
  of the script (and any associations defined *after* it are never created)".

---

## Severity 1 — silent data loss

### 1. Objects created in a microflow are never committed, and everything reports success **[platform]**

The single most expensive finding of the build. A seed microflow of ~160
`create` activities ran, logged success, and left an empty database. Nothing in
the toolchain flagged it: `mxcli check` passed, `mx check` reported 0 errors, the
microflow's own `log info` fired, and the runtime start was clean.

```
$ ./mxcli exec mdlsource/11-seed-week30.mdl -p TimeRegistration.mpr
Created microflow: TimeReg.SED_Week30

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
The app contains: 0 errors.

# after boot, the seed logs success:
2026-07-29 10:30:44.192 INFO - TimeRegSeed: Seeded week 30
2026-07-29 10:30:44.437 INFO - TimeRegSeed: Demo data ready

# but nothing was written:
$ psql -h 127.0.0.1 -U mendix -d timeregistration -tAc \
    "select 'clients='||count(*) from \"timereg\$client\";"
clients=0
```
*(captured during the build)*

Exactly one row existed in the whole schema — the one object that happened to be
committed by a sub-microflow. `create` produces an uncommitted object; that is
correct Mendix behaviour, but a 160-activity seed that "succeeds" into an empty
database is a trap worth knowing about before you write one.

**Workaround.** Accumulate per entity type and commit in dependency order, so a
child is only committed once its parent row exists:

```mdl
$lRole = create list of "TimeReg"."Role";
$rPartner = create "TimeReg"."Role" (Name = 'Partner', ...);
add $rPartner to $lRole;
...
commit $lRole;   -- before the entities that reference a Role
```

**Related trap:** a sub-microflow that reads what the caller just created must
run *after* the commits. `ACT_RecalculateTimesheet` sat before them and computed
totals of zero from an empty retrieve — again with no error anywhere.

**Suggestion for mxcli.** A lint rule along the lines of "microflow creates
objects of entity X but never commits them, and does not return them" would have
caught this statically.

---

## Severity 2 — mxcli parser bugs

### 2. `V3` is not a usable identifier **[bug]**

`V3` is rejected wherever an attribute name is expected. `V1`, `V2`, `V4`, `V5`,
and every other letter+digit pair tested parse fine, so it is `V3` specifically —
presumably a reserved token in the lexer.

```
$ cat probe.mdl
create or modify microflow "TimeReg"."PROBE_V3" ()
returns boolean as $ok
begin
  $r = create "TimeReg"."RateRow" (
    V1 = 'a',
    V2 = 'b',
    V3 = 'c');
  return true;
end;
/

$ ./mxcli check probe.mdl -p TimeRegistration.mpr
Syntax errors found:
  - line 7:4 mismatched input 'V3' expecting the start of a statement (create, alter, drop, show, describe, …)
```

Narrowing it, one name per run:

```
V1   parses=1
V2   parses=1
V3   parses=0     <-- only this one
V4   parses=1
V5   parses=1
K1   parses=1
K3   parses=1
T3   parses=1
D3   parses=1
C3   parses=1
```

The same rejection happens in a page binding: `dynamictext x (Attribute: V3, …)`
fails, `Attribute: "V3"` works.

**Workaround.** Quote it — `"V3" = $v3` and `Attribute: "V3"`. The project-wide
advice to quote every identifier (in the generated `CLAUDE.md`) exists for
exactly this class of problem; it is worth following from the first line rather
than after the first failure.

### 3. Index names cannot be quoted **[bug]**

Quoting is safe everywhere else, and the generated `CLAUDE.md` says to quote all
identifiers — but an index name must be bare.

```
$ cat probe.mdl
create persistent entity Probe.Thing (Code: string(20))
index "idx_thing_code" (Code);
/

$ ./mxcli check probe.mdl -p TimeRegistration.mpr
Syntax errors found:
  - line 2:6 extraneous input '"idx_thing_code"' expecting {ON, '(', IDENTIFIER}
```

**Workaround.** `index idx_thing_code (Code)`.

### 4. `alter entity … add <attr>` is not the documented shorthand **[bug]**

`mdl-entities.md` and the generated `CLAUDE.md` both describe `ALTER ENTITY …
ADD …`; the parser wants the full `ADD ATTRIBUTE` form, and the error does not
say so.

```
$ cat probe.mdl
alter entity "TimeReg"."Matter" add "Foo": string(10);
/

$ ./mxcli check probe.mdl -p TimeRegistration.mpr
Syntax errors found:
  - line 1:36 no viable alternative at input 'add"Foo"'
```

**Workaround.** `ALTER ENTITY "TimeReg"."Matter" ADD ATTRIBUTE IF NOT EXISTS "Foo": string(10);`
— found via `./mxcli syntax domain-model.entity.alter`, which documents it
correctly. The `syntax` subcommand was consistently more accurate than the
bundled skill files.

### 5. Quoting rules for role names are inconsistent **[bug]**

`describe` requires quotes, `drop` rejects them.

```
$ ./mxcli -p TimeRegistration.mpr -c "DESCRIBE USER ROLE Administrator"
Parse error: line 1:57 missing STRING_LITERAL at 'Administrator'

$ ./mxcli -p TimeRegistration.mpr -c "DESCRIBE USER ROLE 'Administrator'"
create user role Administrator (System.Administrator, …) manage all roles;

$ ./mxcli -p TimeRegistration.mpr -c "drop user role 'User'"
Parse error: line 1:15 mismatched input ''User'' expecting the start of a statement

$ ./mxcli -p TimeRegistration.mpr -c "drop user role User"
Dropped user role: User
```

Demo users take the opposite convention again — `drop demo user 'demo_user'`
needs the quotes.

### 6. A bad language code corrupts the model with no error at write time **[bug]**

`alter settings LANGUAGE` accepts a language that is not in the project. The
write reports success; the next `mx check` dies with an unhandled
NullReferenceException rather than a model error.

```
$ ./mxcli exec mdlsource/41-settings.mdl -p TimeRegistration.mpr   # DefaultLanguageCode = 'nl_NL'
Updated language settings

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
ERROR: System.AggregateException: One or more errors occurred. (Object reference not set to an instance of an object.)
 ---> System.NullReferenceException: Object reference not set to an instance of an object.
   at CommandLine.ParserResultExtensions.WithParsed[T](ParserResult`1 result, Action`1 action)
   at Mendix.MxToolset.MxToolset.ProcessArguments(String[] commandLineArgs)
```
*(captured during the build)*

Recovered by setting it back to `'en_US'`. mxcli should validate the code against
the project's language list before writing.

---

## Severity 3 — expression and statement limits

These are Mendix platform rules. mxcli reports most of them well; they are listed
because each cost a build cycle.

### 7. `call microflow` is a statement, never an expression **[platform]**

Not valid after `set`, and not valid inside a `create` attribute list.

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr      # set $rate = call microflow …
Syntax errors found:
  - line 7:19 mismatched input 'microflow' expecting END

$ ./mxcli check probe.mdl -p TimeRegistration.mpr      # SortOrder = call microflow … inside create
Syntax errors found:
  - line 8:21 mismatched input 'microflow' expecting ')'
```

**Workaround.** `$rate = call microflow …;` on its own line (no `set`), then use
`$rate`.

### 8. Aggregates declare their own output variable **[platform]**

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr
  statement 1: microflow 'TimeReg.PROBE_Agg' has validation errors:
  - duplicate variable name '$total' — aggregate list output variable is already declared in this scope (CE0111)
```

**Workaround.** Drop the `declare`: `$total = sum($list.Hours);`. Note this is the
opposite of the rule for every other variable, where `set` on an undeclared name
is an error.

### 9. Aggregates are not expression functions either **[platform]**

`count($list) > 0` inside an `if` fails. mxcli's diagnostic here is excellent —
it names the fix:

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr
  ✗ if condition calls 'count()', which is not a Mendix expression function — the
    build fails CE0117 "Error(s) in expression" [MDL044]
      at TimeReg.PROBE_CountIf
      → 'count' is an aggregate activity, not an expression function. Assign it to
        a variable first: $n = count($List); then use $n in the expression.
```

Same for `sum()` inside a `create` attribute list, and for `head()`:

```
  ✗ set 's' calls 'head()', which is not a Mendix expression function — the build
    fails CE0117 "Error(s) in expression" [MDL044]
```

### 10. `not` needs parentheses **[platform]**

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr      # if not $m/IsInternal then
Syntax errors found:
  - line 5:9 missing THEN at '$m'
  Mendix requires parentheses around a negated expression — a bare
  'not <expr>' does not parse:
    if not($Cell/IsInvalid) then …   (correct)
    if not $Cell/IsInvalid then …    (wrong — causes parse error)
```

The hint is printed with the error, which is how it should work everywhere.

### 11. `= empty` does not work on an association in XPath **[platform]**

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr
  ✗ retrieve '$rows' constraint tests association
    `TimeReg.MatterMonthSummary_Employee = empty`, which Mendix XPath does not
    support (CE0161 "Error(s) in XPath constraint") — `= empty` works on
    attributes, not associations [MDL047]
```

**Workaround.** Carry an explicit boolean. I added `IsFirmWide` to
`MatterMonthSummary` to distinguish a firm-wide total from a per-employee slice.

### 12. Widget expressions cannot follow associations **[platform]**

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr
  ✗ page TimeReg.ProbePage2: widget `row1` property `DynamicClasses` expression
    traverses association `TimeReg.MatterMonthSummary_Matter` — Mendix expressions
    cannot follow associations (CE0117). Bind the value via a data binding
    (contentparams/attribute) or precompute it onto the bound entity [MDL-WIDGET13]
```

This shapes the domain model. `ContentParams` *can* follow an association
(`{1} = Assoc/Attr`), but `DynamicClasses` and `Visible` cannot — so anything
driving conditional styling has to be denormalised onto the bound entity. That is
why `MatterMonthSummary` carries `MeterClass`, `BudgetPct` and `RateLabel`.

### 13. `sort by` wants the unquoted dotted form **[bug]**

Quoting the attribute — which is correct everywhere else — silently produces a
nonsense reference that only fails on write:

```
$ ./mxcli exec mdlsource/21-datasources.mdl -p TimeRegistration.mpr
Error: microflow 'TimeReg.DS_WeekRows' has validation errors:
  - sort by attribute '"TimeReg"."Matter"."Code"' does not belong to entity 'TimeReg.Matter'
  - sort by attribute '"TimeReg"."TaskCode"."SortOrder"' does not belong to entity 'TimeReg.TaskCode'
```

**Workaround.** `sort by TimeReg.Matter.Code asc` — bare, dotted, unquoted, even
inside a statement whose other identifiers are quoted.

### 14. `DataSource: association $currentObject/…` does not parse **[bug]**

The `association` keyword and the `$currentObject/` sugar are mutually exclusive,
which the docs do not say.

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr
Syntax errors found:
  - line 3:41 mismatched input '$currentObject' expecting {',', ')'}
```

**Workaround.** Drop the keyword: `DataSource: $currentObject/"TimeReg"."AuditEntry_Timesheet"`.

---

## Severity 4 — `mxcli check` gaps

`migrate-design-prototype.md` warns that "a real `docker build` is the only
trustworthy check". Confirmed repeatedly. Everything below passed
`mxcli check --references` and failed at MxBuild.

### 15. Duplicate widget names across a page **[gap]**

A container and a listview both named `ruTop`:

```
$ ./mxcli check mdlsource/34-page-rollup.mdl -p TimeRegistration.mpr --references
✓ Syntax OK (1 statements)
✓ All references valid

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
[error] [CE0495] "Duplicate name 'ruTop'." at List view 'ruTop'
The app contains: 1 errors.
```

### 16. Duplicate variable names across mutually exclusive branches **[gap]**

Two `retrieve`s in two branches of an `if` that can never both run still collide;
Mendix scopes variable names per flow, not per branch.

```
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
[error] [CE0111] "Duplicate variable name 'rows'." at Retrieve object(s) activity
[error] [CE0111] "Duplicate variable name 'timesheet'." at Retrieve object(s) activity
The app contains: 2 errors.
```

### 17. Aggregate-in-expression inside `create` **[gap]**

`RowTotal = formatDecimal(sum($cells.Hours), '###0.00')` passed check and failed
the build with a message that does not mention `sum`:

```
[error] [CE0117] "Error(s) in expression." at Create object activity
  'Create WeekRow (MatterName, MatterSub, BillLabel, BillClass, D1, …)'
The app contains: 2 errors.
```

### 18. Missing member grants under production security **[gap]**

Turning security on surfaced 41 errors that no earlier check mentioned — including
that a member list on a `grant` must name **associations** as well as attributes:

```
[error] [CE2729] "No read access to association 'MatterMonthSummary_Matter' in entity
  'TimeReg.MatterMonthSummary' for user role 'FeeEarner'." at Text 'mmMatter'
```

**Workaround.** `read *` with a row constraint, rather than a hand-written member
list, wherever the constraint already limits the rows to the user's own.

---

## Severity 5 — modelling constraints worth knowing up front

### 19. MDL cannot set a microflow's "apply entity access" flag **[bug]**

This one has security consequences. A microflow datasource runs with full rights
unless the microflow is marked *Apply entity access*, and MDL exposes no way to
set it — `describe microflow` does not round-trip the property either:

```
$ ./mxcli -p TimeRegistration.mpr -c "DESCRIBE MICROFLOW TimeReg.DS_TeamWeek"
create or modify microflow TimeReg.DS_TeamWeek ()
returns List of TimeReg.Timesheet as $rows
folder 'Datasources'
begin
  retrieve $rows from TimeReg.Timesheet where WeekNumber = 30 sort by …;
  return $rows;
end;
```

So row-level access rules do **not** constrain a microflow datasource. A page
whose list comes from `database from …` is scoped by the access rules; the same
list from a microflow is not.

**Workaround.** Scope inside the microflow as well as in the access rule.
`DS_TeamWeek` now filters to the signed-in partner's reports explicitly, and the
reason is written in its documentation so nobody removes it later. Anyone
building security-sensitive screens with mxcli should assume every microflow
datasource is unconstrained until proven otherwise.

### 20. Non-persistent entities still need access rules **[platform]**

`WeekRow`, `WeekTotal` and `RateRow` hold no data of their own but are built per
request, so every role that opens the page needs create/read on them. Easy to
miss because they never appear in the database.

### 21. Pages cannot forward-reference each other **[bug]**

Every screen has a "Log time" button pointing at `NewEntry`, so the first page to
be created always references one that does not exist yet:

```
$ ./mxcli exec mdlsource/30-page-week.mdl -p TimeRegistration.mpr
Error: failed to build page: failed to build widget: failed to build action:
  failed to resolve page: page not found: TimeReg.NewEntry
```

**Workaround.** Generate one stub file that creates all pages with a placeholder
body, run it first, then apply the real definitions with `create or replace`.
There is a `resolve-forward-references.md` skill but this is simpler.

### 22. `create` needs a unique output variable per statement **[platform]**

Reusing a throwaway name across 31 `create`s in one seed:

```
$ ./mxcli check mdlsource/10-seed-reference.mdl -p TimeRegistration.mpr --references
  - duplicate variable name '$x' — create output variable is already declared in this scope (CE0111)
  … × 31
```

**Workaround.** Number them (`$cr1`, `$cr2`, …). Trivial once you know, and worth
doing from the start in a generated seed.

### 23. `create microflow` is not idempotent; re-running a script fails **[platform]**

```
$ ./mxcli check probe.mdl -p TimeRegistration.mpr --references
  statement 1: microflow already exists in project: TimeReg.DS_CurrentEmployee — use CREATE OR MODIFY to update it
```

The error names the fix, which is good. Write `create or modify` / `create or
replace` / `add attribute if not exists` from the first draft — a build is dozens
of re-runs and every non-idempotent statement becomes a manual edit later.

### 24. `mxcli oql` needs runtime admin credentials **[platform]**

Not usable for a quick data check against `run --local` without extra setup:

```
$ ./mxcli oql "select 1" -p TimeRegistration.mpr
Error: admin password required: set --token, M2EE_ADMIN_PASS env var, or configure .docker/.env
```

**Workaround.** Query PostgreSQL directly. Table names are `module$entity`
lowercased, associations are `module$assocname` columns:

```
$ psql -h 127.0.0.1 -U mendix -d timeregistration -c \
  'select e.fullname, t.recordedhours from "timereg$timesheet" t
     left join "timereg$employee" e on e.id = t."timereg$timesheet_employee";'
```

Note `pg_stat_user_tables.n_live_tup` is an estimate and read 0 for tables that
had rows — use `count(*)`.

### 36. A lint rule suggests a command mxcli does not implement **[bug]**

`SEC005` tells you to enable strict XPath mode and gives the exact statement. The
parser has no such statement:

```
$ ./mxcli lint -p TimeRegistration.mpr
  ⚠ Strict mode is disabled. This weakens XPath constraint enforcement and is
    relevant to CVE-2023-23835. [SEC005]
      at ProjectSecurity
      → ALTER PROJECT SECURITY STRICT MODE ON

$ ./mxcli -p TimeRegistration.mpr -c "alter project security strict mode on"
Parse error: line 1:23 no viable alternative at input 'alterprojectsecuritystrict'

$ ./mxcli syntax security.project-security
Syntax:
  ALTER PROJECT SECURITY LEVEL OFF|PROTOTYPE|PRODUCTION;
  ALTER PROJECT SECURITY DEMO USERS ON|OFF;
```

Strict mode has to be set in Studio Pro, so a security posture mxcli's own linter
recommends cannot be reached from MDL.

### 37. `login.js` overwrites the sign-in page's labels at runtime **[platform]**

Rewriting `theme/web/login.html` to the design's wording had no effect: the
platform's `login.js` reads `window.i18nMap` and writes over `#loginHeader`,
`#usernameLabel` and `#passwordLabel` after the page renders. The markup said
"Firm e-mail"; the browser showed "User name".

**Workaround.** Patch the map between the two scripts, which keeps the shipped
error messages:

```html
<script src="js/login_i18n.js?{{cachebust}}"></script>
<script>
  window.i18nMap = Object.assign(window.i18nMap || {}, {
    username: "Firm e-mail",
    loginHeader: "Firm account"
  });
</script>
<script src="js/login.js?{{cachebust}}"></script>
```

Also note `theme/web/js/` contains only `toggle-password.js`; `login.js` and
`login_i18n.js` come from Atlas and appear only in `deployment/web/js/` after a
build, which is where you have to read them.

### 38. Atlas's `.form-group` is a flex row, so a stacked label collapses the input

Setting `display: block` on the label was not enough — the input stayed 50px
wide, because `.form-control` carries `flex: 1 1 0%; min-width: 50px` and the
group lays out as a row:

```
.form-control { display: flex; flex: 1 1 0%; min-width: 50px; height: var(--form-input-height); }
```

**Workaround.** Reset the group as well as the label:

```scss
.vdh-login .form-group { display: block !important; width: 100%; }
.vdh-login .form-group > * { flex: none; width: 100%; }
.vdh-login .form-control { display: block; width: 100% !important; max-width: none; }
```

### 49. `alter page … replace` drops the attribute binding off the replacement **[bug]**

Unpinning the week screen from week 30 meant turning static text into bound
widgets — the seven day headers, the week range, the status flag. `ALTER PAGE
… REPLACE` is exactly the operation for that, and it silently discards the
binding:

```mdl
alter page "TimeReg"."WeekTimesheet" {
  replace weekStatus with {
    dynamictext probeStatus (Attribute: StatusLabel, Class: 'vdh-flag')
  }
}
```
```
$ ./mxcli exec p.mdl -p TimeRegistration.mpr
Altered page TimeReg.WeekTimesheet

$ ./mxcli -p TimeRegistration.mpr -c 'describe page "TimeReg"."WeekTimesheet"' | grep probeStatus
dynamictext probeStatus (Content: '{1}', ContentParams: [{1} = <unbound>], Class: 'vdh-flag')

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
[error] [CE0402] "No value specified." at Text 'probeStatus'
The app contains: 1 errors.
```

`Attribute: StatusLabel` became `{1} = <unbound>`. The same happens to
`ContentParams` on a replacement with a template. MxBuild does catch it, which is
the only reason it is not worse — but nine widgets replaced this way produced
nine CE0402s and no clue as to why.

**Not universal.** An `actionbutton` replacement keeps its `Action`, including
the microflow and its `$currentObject` argument, and `set` / `drop widget` are
both fine. It is specifically the attribute binding on a replacement widget.

**Workaround.** Edit the page in its own source file and re-run the whole
`create or replace page`. That is better practice anyway — the page then has one
definition rather than a definition plus a patch — but it does mean `ALTER PAGE`
is not usable for the one job it looks made for.

**Fixed by PR 55** along with finding 55, which is the same defect reached
through `INSERT`. This exact `replace weekStatus` reproduction now keeps its
binding. The workaround is still the tidier habit; it is no longer forced.

### 50. `daysBetween` returns a magnitude, not a signed difference **[platform]**

Nothing to do with mxcli, and the most expensive hour of the multi-week work.
Week navigation derives the week number from the offset to a known anchor
(Monday 20 July 2026 is week 30):

```mdl
set $offset = round(daysBetween(dateTime(2026, 7, 20), $WeekStart) div 7);
set $week = 30 + $offset;
```

Forward that is right. Backward it counts *up*:

```
at: Week 30 · 20–26 Jul 2026
at: Week 31 · 13–19 Jul 2026     <- ‹ moved back a week
at: Week 32 · 6–12 Jul 2026
at: Week 33 · 29 Jun – 5 Jul 2026
```

The dates are correct throughout — only the number derived from `daysBetween` is
wrong, which is what makes it easy to miss: the screen looks like it is working.

The same call reads the other way round in the entry form, where "is today
inside the week I am looking at?" was written as `0 <= daysBetween(weekStart,
today) < 7`. Standing on 29 July looking at the week of 3 August, that is five
days *before* the week and it answered five days *into* it.

**Workaround.** Put the sign back by comparing the dates, which is the one thing
that does behave:

```mdl
set $days = daysBetween(dateTime(2026, 7, 20), $WeekStart);
if $WeekStart < dateTime(2026, 7, 20) then
  set $days = -$days;
end if;
```

Worth knowing that `ACT_SaveTimeEntry`, written weeks earlier in this project,
clamps `daysBetween(entryDate, now)` with `if $late < 0 then set $late = 0` —
dead code written by someone (me) who assumed the opposite.

### 51. `create association` is not idempotent, and the failure cascades into an unloadable project **[bug]**

`create or modify entity` exists and re-running it is a no-op. `create
association` has no such form in the skill files, and re-running one is a hard
error:

```
$ ./mxcli exec mdlsource/76-domain-period.mdl -p TimeRegistration.mpr
Error: association already exists: TimeReg.PeriodSelection_Employee
```

Same shape as finding 23 (`create microflow`), and the fix is the same — `create
or modify association` parses and works, it is simply undocumented:

```mdl
create or modify association "TimeReg"."ClientReport_Period"
from "TimeReg"."ClientReport" to "TimeReg"."Period"
type reference;
```

**The cascade is the expensive part.** The error aborts the script at the first
duplicate, so the three *new* associations further down the file were never
created. The next script set those associations inside a `create` activity, and
mxcli wrote them as unresolved **attribute** references without complaining:

```
$ ./mxcli exec mdlsource/12-seed-period.mdl -p TimeRegistration.mpr
Replaced microflow: TimeReg.SED_Period

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
ERROR: Mendix.Modeler.Storage.StorageLoadException: One or more invalid values were
detected while loading the project: Mendix.Modeler.Projects.Project:
 - Change in  has an invalid value '' for property Attribute. The text
   'TimeReg.TimelinessBand_Period' is not a valid AttributeIdentifier.
```

Not "0 errors", not "1 error" — `mx check` cannot load the `.mpr` at all. A
member assignment naming something that does not exist should be rejected by
`mxcli exec`, or at least by `--references`; instead it corrupts the project and
the only clue is a .NET load exception two commands later.

### 52. `dateTime()` accepts literal constants only **[platform]**

Summarising a month means the first of it, and the obvious spelling does not
compile:

```mdl
set $from = dateTime($Period/Year, $Period/MonthNumber, 1);
```
```
$ ./mxcli check mdlsource/77-period-logic.mdl
  ✗ set 'from' calls dateTime()/dateTimeUTC() with a non-literal argument, which
    Mendix rejects (CE0117 "Error(s) in expression") — these functions accept
    only hardcoded numeric constants  [MDL046]
```

Credit where due: `mxcli check` catches this before MxBuild does, and names the
rule. The way round is to parse rather than construct:

```mdl
set $from = parseDateTime('1-' + toString($Period/MonthNumber) + '-' + toString($Period/Year), 'd-M-yyyy');
set $to = addMonths($from, 1);
```

Its neighbour MDL045 is less accurate — it reads the `/` of an association path
inside a `div` as a second division operator and rejects a correct line:

```mdl
set $budgetPct = round($matterHours div $matter/BudgetHours * 100);   -- rejected
```

Hoisting the attribute into a variable first satisfies it, and reads better
anyway.

### 53. MDL048 rejects `[id = '[%CurrentUser%]']`, which works **[bug]**

Resolving the signed-in account is the standard Mendix idiom, and `mxcli check`
calls it an error:

```mdl
retrieve $me from System.User where [id = '[%CurrentUser%]'] limit 1;
```
```
$ ./mxcli check mdlsource/78-period-datasources.mdl
  ✗ retrieve '$me' constrains the object id against a value
    (`[id = '[%CurrentUser%]']`), which Mendix XPath does not support
    (CE0161 "Error(s) in XPath constraint") — there is no id operator reachable
    from a microflow expression  [MDL048]
```

It is supported, and it runs. The same line has been in `ACT_ClaimTask` since the
workflow work, where it is what assigns a user task to the person completing it —
and the database says it worked:

```
$ psql … -c "select u.name, t.state from system\$workflowusertask_assignees j …"
 j.haverkamp@vdh-law.nl | Completed
```

`mx check` reports 0 errors on the same project, and `mxcli exec` writes the
microflow regardless — the rule only costs you a false alarm. Worth knowing
before you go looking for a way round something that is not broken.

The counterpart to finding 27: the MDL0xx diagnostics are mostly excellent, and
MDL045 (finding 52) and this one are the two that cried wolf.

### 54. `describe microflow` renders `set task outcome` as "Empty action" **[bug]**

Found while confirming the decision logic had actually moved into the workflow.
`ACT_ApproveFromTask` is three statements — claim, set the outcome, show the
inbox — and describe shows two of them:

```
$ ./mxcli -p TimeRegistration.mpr -c 'describe microflow "TimeReg"."ACT_ApproveFromTask"'
begin
  $claimed = call microflow TimeReg.ACT_ClaimTask(Task = $Task) on error rollback;
  -- Empty action
  show page TimeReg.MyTasks;
  return;
end;
```

The `-- Empty action` is exactly where `set task outcome $Task 'Approve';` sits.
The statement is stored and works — the same microflow completes the task and
drives the workflow's Approve branch, proven by the run above — so this is a read
gap, not a write one. It is the same shape as finding 42 (`describe workflow`
dropping `with (…)`), which PR 53 fixed; the microflow side of the workflow
statements still has it.

Worth knowing because `describe → drop → exec` is the documented way to
regenerate a document, and here it would silently drop the one statement that
completes the task.

### 55. `alter page … insert` drops the attribute binding too, and it is still there on `0580ead` **[bug]**

Finding 49 recorded this for `REPLACE`. Adding an entry list to the week screen
needed `INSERT`, which looked like the safe operation — the existing widgets are
not touched at all, only a sibling added. It behaves the same way:

```mdl
alter page "TimeReg"."WeekTimesheet" {
  insert after wrTotal {
    dynamictext probe49 (Attribute: RowTotal, Class: 'vdh-probe')
  }
}
```
```
$ ./mxcli exec -p TimeRegistration.mpr /tmp/probe49.mdl
Altered page TimeReg.WeekTimesheet

$ ./mxcli -p TimeRegistration.mpr -c 'describe page "TimeReg"."WeekTimesheet"' | grep probe49
dynamictext probe49 (Content: '{1}', ContentParams: [{1} = <unbound>], Class: 'vdh-probe')
```

So it is the binding on any widget MDL *writes* into an existing page, not the
`REPLACE` operation specifically. `ALTER PAGE` remains usable for captions,
classes, visibility and buttons, and unusable for anything that displays data.

**Fixed by PR 55**, in two rounds — association and database sources first, then
microflow sources. Finding 49's original `REPLACE` reproduction is closed with
it, and the workaround below is no longer needed. See the retest at the top.

**One thing worth recording alongside it.** Re-running a full `create or replace
page` against a page that already exists **preserves the unit** — the same
`mprcontents/**.mxunit` file is rewritten rather than a new one created:

```
$ grep -rl WeekTimesheet mprcontents | head -1
mprcontents/af/c9/afc94389-9369-4cb4-bfcf-23f989893671.mxunit
$ ./mxcli exec -p TimeRegistration.mpr mdlsource/30-page-week.mdl
Created page TimeReg.WeekTimesheet
$ grep -rl WeekTimesheet mprcontents | head -1
mprcontents/af/c9/afc94389-9369-4cb4-bfcf-23f989893671.mxunit
```

That is what makes finding 49's workaround safe: navigation items and every
`show page` in a microflow keep pointing at the page. The
`resolve-forward-references` skill warns that `OR REPLACE` "deletes the
placeholder and creates a new document with a different ID", which is true of
the *placeholder* pattern it describes but not of re-issuing a page definition —
worth stating, because the warning reads as a reason not to do the thing finding
49 tells you to do.

---

## Workflows

Everything in this section comes from replacing the enumeration-and-microflow
approval with a real Mendix Workflow document. `CREATE WORKFLOW` works, and the
resulting process runs — but the one activity every approval workflow needs
does not, and neither checker says so.

### 39. A workflow that calls a microflow builds cleanly and then the runtime refuses to load the model **[bug]**

The worst finding of this session, and the direct sequel to finding 1: both
checkers pass, and the failure lands at runtime — not on the workflow, on the
*whole application*.

The natural way to write an approval workflow is an outcome branch that calls a
microflow:

```mdl
user task Review 'Approve week timesheet'
  page "TimeReg"."WF_ApproveTask"
  outcomes
    'Approve' { call microflow TimeReg.ACT_ApproveWeek
                  with (Timesheet = '$workflowContext'); }
    'Return'  { call microflow TimeReg.ACT_ReturnWeek
                  with (Timesheet = '$workflowContext'); };
```

Both checkers are happy:

```
$ ./mxcli check mdlsource/62-workflow.mdl
✓ Syntax OK (1 statements)

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
The app contains: 0 errors.
```

The runtime is not:

```
$ ./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch
Building (first build is cold, ~10-15s)...
Error: starting runtime: start failed: class java.lang.RuntimeException occurred
while executing an admin action request.

2026-07-29 13:13:50.445 ERROR - Core: Failed to load model: An error occurred
while reading the Application Model
Caused by: java.lang.RuntimeException: An error occurred while reading the model
file at .../deployment/model/model.mdp.
Caused by: java.lang.RuntimeException: No new model classes have arrived within
ten seconds, aborting model initialization(Class 'Workflows$CallMicroflowTask'
could not be found).
```

The app does not start at all — every screen, not just the workflow.

**Cause.** mxcli's generated metamodel calls the activity `CallMicroflowTask`;
Mendix 11.12.1 calls it `CallMicroflowActivity`:

```
$ grep -c "WorkflowsCallMicroflowTask" /opt/mxcli-src/generated/metamodel/types.go
6
$ unzip -p ~/.mxcli/runtime/11.12.1/runtime/bundles/com.mendix.workflows-metamodel.jar \
    | strings | grep -o 'Workflows\$CallMicroflow[A-Za-z]*' | sort -u
Workflows$CallMicroflowActivity
```

Diffing every `Workflows$…` name mxcli can emit against the ones the runtime
knows shows this is the only *activity* affected — the rest of what a workflow
needs (`SingleUserTaskActivity`, `UserTaskOutcome`, `MicroflowUserTargeting`,
`PageReference`, `Flow`, `StartWorkflowActivity`, `EndWorkflowActivity`) is
present in both:

```
$ comm -13 runtime-names.txt mxcli-names.txt
Workflows$Annotation
Workflows$BezierCurve
Workflows$BooleanCase
Workflows$CallMicroflowTask      <- the one that is actually reachable
Workflows$FloatingAnnotation
Workflows$FlowLine
Workflows$OrthogonalPath
Workflows$StringCase
Workflows$VoidCase
Workflows$WorkflowMetaData
```

**Workaround (used until PR 53 landed; see the retest at the top).** Leave the
outcome branches empty and do the work on the way *in* to the outcome. There is no `complete task` microflow statement, but there
*is* `set task outcome`, which completes the task with a named outcome — so a
microflow can do the domain change and then complete the task:

```mdl
create or modify microflow "TimeReg"."ACT_ApproveFromTask" ($Task: System.WorkflowUserTask)
begin
  $claimed   = call microflow "TimeReg"."ACT_ClaimTask" ("Task" = $Task);
  $timesheet = call microflow "TimeReg"."DS_TaskTimesheet" ("Task" = $Task);
  if $timesheet != empty then
    $approved = call microflow "TimeReg"."ACT_ApproveWeek" ("Timesheet" = $timesheet);
  end if;
  set task outcome $Task 'Approve';
  show page "TimeReg"."MyTasks";
end;
```

The task page's buttons call that instead of `complete_task`. The outcomes still
exist and the engine still records which one was chosen; the branch bodies have
nothing left to do. Verified end to end — see APP.md.

### 40. A workflow `call microflow` with no parameter mapping passes both checkers **[gap]**

Independently of finding 39, an unmapped required parameter is invisible.
Compare — same workflow, one with the mapping and one without:

```mdl
call microflow TimeReg.ACT_ApproveWeek with (Timesheet = '$workflowContext');   -- mapped
call microflow TimeReg.ACT_ApproveWeek;                                          -- unmapped
```

```
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr    # mapped
The app contains: 0 errors.
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr    # unmapped
The app contains: 0 errors.
```

`ACT_ApproveWeek` has one required parameter. Studio Pro flags an unmapped
parameter as an error; here nothing does, and the workflow would fail at the
activity. Write the mapping even where it looks obvious.

### 41. The `with (…)` parameter name must be bare; the qualified form corrupts the model **[bug]**

Three spellings, three outcomes. Only the third works.

Fully qualified — the parameter id is written as null and `mx check` no longer
loads the project at all:

```mdl
call microflow TimeReg.ACT_ApproveWeek
  with (TimeReg.ACT_ApproveWeek.Timesheet = '$workflowContext');
```
```
$ ./mxcli exec a.mdl -p TimeRegistration.mpr
Created workflow: TimeReg.WF_Probe

$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
ERROR: System.AggregateException: One or more errors occurred. (An error occurred
when trying to set the 'Parameter' property of a Microflow call parameter mapping
in a Workflow with ID 8b9b8f24-b986-48ae-a684-30a0a664c1a2.)
 ---> System.ArgumentNullException: Value cannot be null. (Parameter 'value')
   at Mendix.Modeler.Workflows.Model.MicroflowCallParameterMapping.set_ParameterId(...)
```

Quoted — the quotes become part of the name that is looked up:

```mdl
with ("Timesheet" = '$workflowContext');
```
```
[error] [CE1613] "The selected parameter 'TimeReg.ACT_ApproveWeek."Timesheet"'
no longer exists." at Old call microflow task 'ACT_ApproveWeek'
The app contains: 1 errors.
```

Bare — correct:

```mdl
with (Timesheet = '$workflowContext');
```
```
The app contains: 0 errors.
```

This is the one place in MDL where the project's "always quote identifiers"
rule is actively wrong.

### 42. `describe workflow` does not round-trip the parameter mappings **[bug]**

The skill file promises `DESCRIBE WORKFLOW` emits re-runnable MDL. It does, but
the `with (…)` clause is dropped, so describe → drop → exec silently loses the
mapping (which, per finding 40, nothing then reports):

```
$ ./mxcli -p TimeRegistration.mpr -c 'describe workflow "TimeReg"."WF_Probe"'
begin
  call microflow TimeReg.ACT_ApproveWeek -- ACT_ApproveWeek
    outcomes
      DEFAULT -> { };
end workflow
```

The mapping was present — `mx check` accepted the project, and the qualified
form of the same clause crashes it (finding 41), so it is stored. It is just
not printed.

### 43. Mendix does not associate a workflow with its context object **[platform]**

A running workflow knows its context, but nothing on the context side points
back, so a task page cannot find the object it is about. Add the association
yourself and set it when the workflow starts:

```mdl
create association "TimeReg"."Timesheet_Workflow"
from "TimeReg"."Timesheet" to System.Workflow
type reference;
```
```mdl
$workflow = call workflow "TimeReg"."TimesheetApproval" (Context = $Timesheet);
change $Timesheet ("TimeReg"."Timesheet_Workflow" = $workflow);
```

The route back is `task → workflow → context`. Going by way of
`System.WorkflowActivity` does not survive the build:

```
$ ./mxcli exec c.mdl -p TimeRegistration.mpr
Replaced microflow: TimeReg.DS_TaskTimesheet
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
[error] [CE1613] "The selected association 'System.WorkflowActivity_WorkflowUserTask'
no longer exists." at Retrieve object(s) activity 'Retrieve from association'
```

Use `System.WorkflowUserTask_Workflow`, which is a direct reference.

### 44. Being targeted by a task is not the same as being allowed to complete it **[platform]**

`set task outcome` on a task the signed-in user is only *targeted* by is
refused in the browser, with nothing in the server log:

```
[console] [Client] You can't complete this user task, it is not assigned to you.
          Error: You can't complete this user task, it is not assigned to you.
```

`System.WorkflowUserTask` has both `_TargetUsers` (eligible) and `_Assignees`
(actually holding it). Studio Pro's generated task page has a Take button for
the transition. MDL has no "assign task" statement, but the association is an
ordinary one:

```mdl
retrieve $me from System.User where [id = '[%CurrentUser%]'] limit 1;
change $Task (System.WorkflowUserTask_Assignees = $me);
commit $Task;
```

### 45. A targeting microflow must accept the workflow as well as the context **[platform]**

The obvious signature — just the context entity — is rejected, and the message
says exactly what is wanted:

```
$ ~/.mxcli/mxbuild/11.12.1/modeler/mx check TimeRegistration.mpr
[error] [CE6677] "The microflow selected for assigning this user task should accept
parameters of type 'System.Workflow' and 'TimeReg.Timesheet'. Instead the selected
microflow 'TimeReg.ACT_WF_Approvers' expects 'TimeReg.Timesheet'." at User task
'Approve week timesheet'
```

Both parameters, in that order, even when the microflow only reads one of them.

### 46. A microflow datasource cannot be handed a page parameter **[platform]**

A page bound to `System.WorkflowUserTask` cannot pass that parameter to a
microflow datasource. Every spelling — `"Task": $Task`, `Task = $Task`,
`$Task = $Task` — produces the same error, because the only argument a
datasource can resolve is `$currentObject`:

```mdl
create or replace page "TimeReg"."WF_Probe" (
  URL: 'wf-probe',
  Params: { $Task: System.WorkflowUserTask }
) {
  container pPage {
    dataview pSheet (DataSource: microflow "TimeReg"."DS_TaskTimesheet"("Task": $Task)) { … }
  }
}
```
```
[error] [CE1571] "No argument has been selected for parameter 'Task' and no default
is available. Please select an argument manually." at Data view 'pSheet'
[error] [CE5601] "The URL property of this Page is missing a parameter segment for
parameter "Task"." at Page 'TimeReg.WF_Probe'
```

Two findings for the price of one: a page with a parameter also needs a URL
segment for it, or no `URL:` at all.

**Workaround for CE1571.** Wrap the body in a DataView on the parameter, which
makes it `$currentObject` for everything inside:

```mdl
dataview wtCtx (DataSource: $Task) {
  dataview wtSheet (DataSource: microflow "TimeReg"."DS_TaskTimesheet"("Task": $currentObject)) { … }
}
```

### 47. System-module enumerations are invisible to mxcli **[gap]**

Filtering user tasks by state means naming `System.WorkflowUserTaskState`, and
mxcli cannot see it — the System module is loaded from the runtime, not from the
`.mpr`:

```
$ ./mxcli -p TimeRegistration.mpr -c 'describe enumeration System.WorkflowUserTaskState'
Error: enumeration not found: System.WorkflowUserTaskState

$ ./mxcli -p TimeRegistration.mpr -c 'show enumerations in System'
| Qualified Name | Module | Name | Folder | Values |
|----------------|--------|------|--------|--------|

(0 enumerations)
```

Entities are documented in `.ai-context/skills/system-module.md`; the
enumerations are not. Constrain on an attribute instead — `[EndTime = empty]`
selects the open tasks without naming a value that cannot be looked up.

### 48. There is no `complete task` statement, and the error does not hint at the one that exists **[gap]**

```mdl
complete task $Task with outcome 'Approve';
```
```
$ ./mxcli check t1.mdl
Syntax errors found:
  - line 5:2 missing END at 'complete'
  - line 5:16 extraneous input '$Task' expecting the start of a statement
    (create, alter, drop, show, describe, …)
```

The statement is `set task outcome $Task 'Approve';`. It is in the grammar
(`MDLMicroflow.g4`, `setTaskOutcomeStatement`) and it works, but it is in none
of the bundled skill files, including `write-workflows.md` — reading the `.g4`
was the only way to find it, alongside `open user task`, `notify workflow`,
`lock workflow` and `workflow operation abort|pause|restart|retry|continue`.

---

## Things that worked better than expected

### 25. Associations can be set inside `create`

Undocumented in the bundled skills, and it removes a whole class of follow-up
`change` activities. Verified through MxBuild:

```mdl
$m = create "TimeReg"."Matter" (
  Code = 'M-2214',
  "TimeReg"."Matter_Client" = $client,
  "TimeReg"."Matter_ResponsiblePartner" = $partner);
```

A ReferenceSet accepts a single object the same way — `change $account
(System.UserRoles = $role)` builds and works.

### 26. The MDL0xx / MDL-WIDGETxx diagnostics are genuinely good

Findings 9, 10, 11 and 12 were each diagnosed *and fixed* by the text mxcli
printed, without reading any documentation. That is a much higher standard than
the raw ANTLR "mismatched input" errors elsewhere, and the gap between the two
classes is the clearest improvement area: the parse errors say where, the
semantic checks say why and what to do.

### 27. `mxcli syntax <topic>` beat the bundled skill files

Where they disagreed (finding 4), `syntax` was right. `./mxcli syntax
domain-model.entity.alter` is worth checking before trusting `CLAUDE.md`.

---

## Mistakes of mine, recorded so they are not repeated

### 28. A cascading parse error made me "find" a limitation that does not exist **[mine]**

I concluded that `if/then/else` could not be used inside a `create` attribute
list, and rewrote seven cells into pre-computed variables. It parses fine:

```
$ cat probe.mdl
  $r = create "TimeReg"."WeekRow" (
    D1 = if $h1 > 0 then formatDecimal($h1, '###0.00') else '·',
    SortOrder = 1);

$ ./mxcli check probe.mdl -p TimeRegistration.mpr --references
✓ Syntax OK (1 statements)
✓ All references valid
Check passed!
```

The real error was a bare `not` (finding 10) forty lines earlier in the same
file, whose recovery garbled everything after it. **Always fix the first parse
error and re-run before believing any subsequent one** — with an ANTLR recovery
strategy, error #2 onward is frequently fiction.

### 29. Partial truncates duplicated the seed **[mine]**

Re-seeding by truncating only the parent tables left the standalone reference
lists (`UtilisationBar`, `TimelinessBand`, `EntryRule`) untouched, while the
guard — which counts `Client` — saw an empty table and ran again. The utilisation
histogram quietly rendered 40 bars instead of 10 across four reseeds.

**Workaround.** Drop and recreate the database rather than truncating a subset:

```bash
psql -h 127.0.0.1 -U mendix -d postgres -c 'drop database if exists timeregistration;'
psql -h 127.0.0.1 -U mendix -d postgres -c 'create database timeregistration owner mendix;'
```

`drop database` fails while the runtime holds connections — stop it first.

### 30. Direct-URL screenshots miss the navigation's active state **[mine]**

Mendix sets `.active` on the nav anchor during client-side routing only. Loading
`/p/week` directly leaves every item inactive, which looked like a CSS bug and
sent me into the cascade for a while:

```
My matters => class="mx-name-navigationTree3-0" li=""
Approvals  => class="mx-name-navigationTree3-3 active" li=""     # only after a click
```

**Workaround.** Drive verification through the menu, not the URL bar.

### 35. The trial licence caps concurrent sessions, which breaks multi-user testing **[platform]**

Signing in as four users in sequence — each in its own browser context — failed
on the third with what looked like a security regression: an empty menu and no
landing page. It was the licence:

```
$ tail .mxcli/runtime.log
Caused by: com.mendix.basis.util.license.LicenseRuntimeException: Maximum number of
  sessions exceeded! (You are currently using a trial license)
	at com.mendix.basis.util.license.LicenseUtil.onNewSession(LicenseUtil.scala:69)
	at com.mendix.basis.session.SessionManager.createSession(SessionManager.scala:284)
	at com.mendix.basis.action.user.LoginActionHandlerImpl.doExecuteAction(LoginActionHandlerImpl.scala:34)
```

Closing the browser context does not end the server-side session, so they
accumulate across runs.

**Workaround.** Visit `/logout` before switching user, and restart the runtime if
sessions have already piled up. Worth knowing before concluding that role-based
access is broken — the failure mode is indistinguishable from a security bug at
the UI level. `.mxcli/runtime.log` is the only place the real cause appears.

---

## Styling notes (not mxcli, but they cost time)

### 31. Atlas's sidebar selector is five classes deep

Item metrics have to match its specificity or they are silently ignored:

```
.layout-atlas-responsive .region-sidebar .mx-scrollcontainer-wrapper
  .mx-navigationtree .navbar-inner > ul > li > a { height: …; padding: … }
```

### 32. A ListView nests every row four levels deep

`ul > li > .mx-dataview > .mx-dataview-content > row`. Any layout where the row
must itself be a flex or grid child — a stacked-bar segment, a chart column —
breaks. Collapsing the wrappers with `display: contents` fixes it and is the only
approach found that keeps the ListView's data binding intact.

### 33. A widget has no computed inline style

`Style:` is a static string and `DynamicClasses` returns class *names*, so no
data-driven width or height is directly expressible. The bucket idiom from
`migrate-design-prototype.md` works: quantise to 0–20 in a microflow, generate
the classes with an SCSS `@for`, select with `DynamicClasses`.

### 34. `display: block` on flex children flattened nested rows

`.vdh-trow > * { display: block }` was defensive and wrong — flex items are
blockified automatically, and the rule overrode `display: flex` on nested
`.vdh-row` cells, stacking content that should have sat side by side. Removing it
fixed several layouts at once.

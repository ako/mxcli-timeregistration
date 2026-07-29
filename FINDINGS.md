# mxcli / MDL findings

Everything that bit, surprised, or needed a workaround while building the
TimeRegistration app with mxcli. Each entry has the command that produces it and
the output as printed.

**Environment**

| | |
|---|---|
| mxcli | `0ed0359` — built from `ako/mxcli` `main`, committed 2026-07-29T03:01:13-07:00 |
| (session 1 built) | `ead8926`, committed 2026-07-28T12:58:07-07:00 |
| Mendix | 11.12.1 (MxBuild + runtime) |
| Engine | `modelsdk` (default) |
| Platform | Ubuntu 24.04.4, Go 1.24.7 with `GOTOOLCHAIN=auto`, JDK 21.0.10, ANTLR 4.13.1 |

Commands below run from `TimeRegistration/`. Reproductions were re-run against
the finished project unless marked *(captured during the build)*.

Legend: **[bug]** mxcli defect · **[gap]** `mxcli check` passes what MxBuild
rejects · **[platform]** a Mendix rule mxcli reports correctly · **[mine]** my own
mistake, recorded so the next person doesn't repeat it.

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

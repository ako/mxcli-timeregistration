# TimeRegistration — van Duyn & Haverkamp

A Mendix implementation of the *Time Registration* design handoff: firm-wide time
capture, weekly approval and monthly client reporting for a Dutch law firm.

Built with [mxcli](https://github.com/ako/mxcli) / MDL. The whole app — domain
model, logic, pages, navigation, demo data — is defined by the scripts in
`TimeRegistration/mdlsource/`, so it can be rebuilt from source.

## Running it

```bash
cd TimeRegistration
./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch
# -> http://localhost:8080
```

The database is seeded on first boot by `TimeReg.ASU_SeedDemoData` (guarded, so a
restart is a no-op). To start from scratch, drop the `timeregistration` database
and boot again.

## Testing it

The "verified end to end" tables below are not a claim to take on trust — they
are a browser suite that drives the app and then checks the database behind it:

```bash
bash tests/reset.sh     # empty database, restart, wait for the seed
node tests/run.mjs      # 136 assertions across the eight specs, ~9 minutes
```

See [tests/README.md](tests/README.md) for what each spec covers.

## Screens

| Screen | URL | What it does |
|---|---|---|
| My matters | `/p/my-matters` | The fee earner's book of work, budget consumption, notices, WTD check |
| Week timesheet | `/p/week` | The week grid — matter × task rows, seven day columns, composition, value, audit trail; ‹ › move between weeks |
| Time entry | `/p/new-entry` | Records an entry; rate resolved from the client agreement on save |
| Edit entry | `/p/edit-entry/{Entry}` | Corrects or removes an entry already recorded, guarded by the week's status and the month's |
| My tasks | `/p/my-tasks` | The approver's inbox — whatever the workflow engine has assigned them |
| Team approvals | `/p/approvals` | The partner's queue for a week, with the flagged entries to review |
| Monthly rollup | `/p/rollup` | Firm KPIs, hours by week/matter/role, the close checklist, WTD exceptions |
| Report · per customer | `/p/report-customer` | Approved time by client, role mix, realisation, statement distribution |
| Report · per matter | `/p/report-matter` | Project Aurora: task breakdown, team, burn vs budget |
| Report · per manager & employee | `/p/report-people` | Utilisation, value, cost and margin per fee earner |
| Rate card | `/p/rate-card` | Standard card and the negotiated client rate matrix as it stood in the selected month, with the change log |

## Domain model

**Recording** — `TimeEntry` is the core fact: a date, decimal hours, a narrative,
a billability and the rate that applied. It hangs off a `Timesheet` (one week per
`Employee`), a `Matter` and a `TaskCode`.

**Reference** — `Client`, `Matter`, `Employee`, `Role`, `TaskCode`, `Period`, and
`ClientRate` (the negotiated rate for one client/role pair).

**Reporting** — the report screens read month-end snapshots
(`ClientMonthSummary`, `EmployeeMonthSummary`, `MatterMonthSummary`,
`MatterTaskSummary`, `RoleMonthSummary`, `PeriodStat`, …) rather than
re-aggregating the entry table on every page load. That mirrors how a real
time & billing system freezes a period at close.

**Identity** — `Employee_Account` ties a fee earner to their sign-in account;
every access rule and every "my" screen resolves through it.

**View models** — `WeekRow` / `WeekTotal` / `RateRow` are non-persistent shapes
built on demand, because the week grid and the rate card are pivots of data
stored one row per day / per client-role pair.

## What is actually computed

The transactional half of the app is real, not staged:

- `ACT_SaveTimeEntry` resolves the rate via `DS_ResolveRate` (negotiated client
  rate for the employee's role, else the role's standard rate; internal matters
  are forced non-billable), values the entry, and recalculates the week.
- `ACT_RecalculateTimesheet` derives recorded / billable / value / ratio from the
  entries, so the week screen, the value panel and the approval row can never
  disagree. It also rebuilds the two panels under the grid — the composition bar
  from each matter's practice area, the rate-band lines from the rate that was
  actually applied per client.
- `DS_WeekRows` pivots the week's entries onto matter × task rows with seven day
  columns; `DS_WeekTotals` produces the day-total band.
- `ACT_SubmitWeek` starts the approval workflow, `ACT_ApproveWeek` /
  `ACT_ReturnWeek` move the week's status and append to its audit trail.
  `ACT_LockPeriod` closes the period.

Verified end to end: recording 3.25 h on Wednesday moved that day 8.00 → 11.25,
the week 36.5 → 39.8, and the value € 9.142 → € 10.036 — exactly 3.25 × € 275,
the Kessler blended rate picked up from the rate agreement.

## Weeks

The domain was always per week — `Timesheet` carries `Year`, `WeekNumber`,
`WeekStart`, `WeekEnd`. It was the screens that were pinned to week 30, with the
day headers and the week range written as static text and `DS_CurrentTimesheet`
asking for `WeekNumber = 30`.

**Where the week comes from.** `WeekSelection` holds one Monday per employee.
It is persistent, not session state: stepping out to the entry form and back, or
signing in tomorrow, lands you in the week you were in. `DS_SelectedWeekStart`
falls back to the most recent week you already have a timesheet for, and then to
the demo anchor, which is why an account with no fee-earner record still lands on
the week the demo dataset is about.

**Opening a week creates it.** `ACT_EnsureTimesheet` finds or creates the
employee's timesheet for a Monday — the same thing turning the page of a paper
timesheet book does. Week number and year are derived from the anchor (Monday
20 July 2026 is week 30) rather than from a locale's calendar rules, so the
numbering is deterministic and agrees with the seeded data. It treats every year
as 52 weeks, which is wrong for the handful of 53-week years and irrelevant here.

**‹ ›** move the selection by seven days and re-open the screen. The week range,
the seven day headers and the status flag all read the timesheet; the labels
themselves are written by `ACT_RecalculateTimesheet`, because a Mendix widget
cannot call `formatDateTime`.

**Copy last week** brings over the previous week's matter/task rows as zero-hour
entries dated the Monday. The rows, not the hours — re-picking eight matter/task
pairs from a combo box is the tedious part, and hours are the one thing nobody
should be handed a default for. Narratives are not copied either: that is invoice
text describing what was done. Pairs already present are skipped, so pressing it
twice is a no-op, and a submitted or approved week is left alone.

**Everything downstream follows.** The entry form attaches to the selected week
and defaults its date to today when today falls inside that week, otherwise to
the Monday. The partner's approval queue shows the week the partner is viewing on
their own timesheet.

### Verified end to end

| Step | Result |
|---|---|
| Open the week screen | Week 30 · 20–26 Jul 2026, headers Mon 20 … Sun 26, 6 rows, 36.50 h |
| **›** | Week 31 · 27 Jul – 2 Aug 2026, headers Mon 27 … Sun 2, no rows, 0.00 h — the week was created on opening |
| **Copy last week** | the same 6 matter/task rows, every cell a middle dot, 0.00 h; audit trail: *"Rows copied from the previous week — 6 matter/task rows, no hours"* |
| **Copy last week** again | still 6 rows |
| **‹** | back to week 30, still 36.50 h — untouched |
| **›** | week 31 still holds its 6 copied rows |
| Log 2.50 h | week 31 totals 2.50 h; the composition bar shows one IP slice, the value panel one Kessler Pharma line at the rate that was applied |
| **‹** six times from week 30 | 29, 28, 27, 26, 25, 24 — with the dates to match |

## Correcting recorded time

For most of this build an entry could be created and never touched again. The
entry form only ever opened blank, nothing anywhere opened one that existed, and
a typo in Monday's hours was permanent — which also made returning a week close
to pointless, since the fee earner could not act on the note.

**The grid stays a summary.** It is one row per matter/task pair with seven day
columns, so a cell can stand for more than one entry and there is nothing there
to click on and correct. Beneath it, **Entries this week** lists what was
actually recorded — date, matter, task, narrative, hours — with an *Edit* on
each row. `EditEntry` is the same seven fields as the new-entry form, bound to an
entry that already exists, plus a right rail showing what it was recorded at:
the rate that applied, the value, when it was entered and how late.

Saving re-runs `ACT_SaveTimeEntry`, so the rate is resolved again from the client
agreement **as at the entry's date** — correcting a date can therefore change the
value, and the form says so. Removing an entry writes a line in the audit trail,
because a deleted entry is otherwise invisible: the grid simply has less in it
than it did.

**One guard, three callers.** Saving, editing and deleting all ask
`VAL_EntryEditable` the same question, because an entry that can be edited is one
that can be edited *around* a restriction:

| State | What happens | Why |
|---|---|---|
| Week `Submitted` | refused — *"This week is with your supervising partner for approval"* | changing it behind the approver makes the figures they approved untrue |
| Week `Approved` | refused | as above, permanently |
| Month `Locked` | refused — *"Jul 2026 is closed. Time can no longer be recorded against it."* | the firm has reported on those figures |
| Month never opened | allowed | time can be recorded forward; `ACT_EnsurePeriod` summarises that month when someone first reports on it |

The month guard is what makes the close mean something. `ACT_LockPeriod` used to
flip a status and nothing on the recording path ever read it — its own
documentation claimed otherwise — so time booked into a closed month was accepted
and silently changed figures that had already gone out.

A refused save leaves the form where it is. That matters: the correction would
otherwise be discarded along with the warning explaining why it was refused.

### Verified end to end

| Step | Result |
|---|---|
| Open the week | 20 entries listed beneath the grid, one **Edit** each |
| **Edit** the first, 2,50 → 9,75 h | back on the week; total 36,50 → 43,75 h, recomputed from the entry table |
| **Remove entry** | 23 entries → 22, audit trail: *"Entry removed — 2,50 h on Mon 20 Jul, …"* |
| **Submit week**, then again | one workflow started, not two; *"This week is already with your supervising partner"*, and no task left unreachable |
| **Edit** an entry on the submitted week | refused, form stays put, nothing written |
| Lock July, then record / edit / delete | all three refused, each naming the period |

## Periods

The month-end summaries were always keyed to a `Period` — `PeriodStat`,
`ClientMonthSummary`, `EmployeeMonthSummary`, `MatterMonthSummary`,
`RoleMonthSummary`, `WeekSummary`, `TrendPoint`, `CloseCheck` and
`WorkingTimeException` all carry a `_Period` reference. What was missing was a
reason to use it: only July 2026 had rows, so every report list could read
`database from …` unconstrained and still look right. With a second month in the
database those screens would have shown two periods stacked on each other.

**`PeriodSelection`** holds one period per employee, exactly as `WeekSelection`
holds one Monday. `DS_SelectedPeriod` falls back to the earliest *open* period —
the one the firm has to close next, which is July 2026 in the seeded dataset —
and, if the firm has closed every month it has, to the most recent one. That
second fallback is not decoration: the ‹ › buttons live *inside* the dataview
this microflow feeds, so returning nothing would blank the reports and take the
means of navigating away from them with it.

**‹ ›** in the header of the rollup and all three reports move a month at a
time, and the selection is shared: step to August on the rollup, open the
per-customer report, and it is already on August. Fourteen report lists now read
their period rather than the whole table.

**Opening a month summarises it.** `ACT_EnsurePeriod` creates a period that has
never been reported on and calls `ACT_RecalculatePeriod`, which derives the five
summaries from the entry table. The guard is the presence of a `PeriodStat`, so
July 2026 arrives from the seed with the handoff's figures and is never
recomputed — the numbers that match the design stay exactly as they were.

Two honest limits on a derived month. The app has no write-off concept, so
billed equals standard and realisation is 100%. And utilisation is measured
against a flat 140-hour month, because `Employee` carries no FTE.

Three lists on the report screens were month-scoped in life but not in the model
— the statement distribution, the utilisation histogram, the timeliness bands.
They gained a `_Period` reference so August does not show July's decoration; a
derived month leaves those three panels empty, which is the truth.

### Verified end to end

| Step | Result |
|---|---|
| Monthly rollup | Jul 2026 · 4.182 h recorded, 3.614 billable, € 1,15M — the seeded snapshot, untouched |
| **›** | Aug 2026 · created and summarised on the spot: 0.0 h, € 0 |
| Open **Per customer** | already on Aug 2026, no client rows and no statements |
| **‹** there | Jul 2026 · 11 rows |
| Open **Per manager & employee** | follows to Jul 2026 · 13 rows |
| Back to the rollup | Jul 2026 with its original figures |
| Book 6.00 h into the week of 3 Aug, reopen the Aug rollup | 6.0 recorded, 6.0 billable, € 1.650 at 100% — 6 × € 275, the Kessler rate; the per-people report now lists Maartje |

An open derived month is recomputed each time it is opened, because time is
still going into it. `Period.IsDerived` is what keeps that away from July: the
seeded snapshot was never derived, so it is never recomputed.

### The rate card is a history, not a snapshot

A negotiated rate is not a fact about a client, it is a fact about a client *and
a date* — which is what the card's own change log had been saying all along:

```
01 Jul 2026   Rijnmond framework indexed +2,1% per contract art. 8.3
14 May 2026   Kessler blended rate € 275 introduced for all roles
01 Apr 2026   Nieuw Amsterdam NGO discount extended to 31 Dec 2026
```

`ClientRate` held one row per client/role with no dates, so the card could only
show today's agreement. It now carries `ValidFrom` and `ValidTo` (empty = open
ended), and the seed reflects the log: the Rijnmond rows start on 1 July with a
superseded set behind them, Kessler starts on 14 May with nothing before it, the
Nieuw Amsterdam discount runs 1 April to 31 December.

`DS_ClientRateAt(client, role, date)` is the single place that reads the window,
and both the card and time entry go through it, so they cannot disagree about
what was agreed when. `DS_ResolveRate` gained a date parameter and
`ACT_SaveTimeEntry` passes the entry's own date — a rate agreed in July never
reprices June's time.

The card prices **as at the end of the selected month**, and says so, because a
mid-month change took effect for part of that month and showing the superseded
agreement for the whole of it would be the wrong half of the truth. The change
log stops at the same date.

| Period | Rijnmond senior | Kessler senior | Change log |
|---|---|---|---|
| Jul 2026 | € 295 | € 275 | four entries, including the indexation |
| Jun 2026 | € 289 — before the +2,1% | € 275 | three |
| Apr 2026 | € 289 | — no agreement | two |

The standard and cost-rate columns are not versioned: `Role` carries one
`StandardRate` and one `CostRate`, so those two columns show today's card in
every month. Versioning them needs a `RoleRate` entity, and the margin figures
on the per-people report would have to read it too.

## Approval is a Mendix Workflow

`TimeReg.TimesheetApproval` is a real workflow document, not a status
enumeration with buttons. Its context entity is `Timesheet`.

```
ACT_SubmitWeek                     start workflow, record it on the Timesheet
  └─ user task "Approve week timesheet"
       targeting  ACT_WF_Approvers → the fee earner's supervising partner
       page       WF_ApproveTask
       due date   addDays([%CurrentDateTime%], 3)
       outcomes   Approve · Return
```

Three things the enumeration could not give: a task assigned to a named person,
a due date the engine tracks, and a decision history the platform keeps.

**My tasks** (`/p/my-tasks`) is the approver's inbox, reading
`System.WorkflowUserTask` for the signed-in user. The Team approvals queue is
still there, but its per-row button now says *Open task* and routes into the
same task page — a week can no longer be approved behind the workflow's back.

**Where the decision happens.** In the workflow. Each outcome branch calls the
microflow that does the work:

```mdl
outcomes
  'Approve' { call microflow TimeReg.ACT_ApproveWeek with (Timesheet = '$workflowContext'); }
  'Return'  { call microflow TimeReg.ACT_ReturnWeek  with (Timesheet = '$workflowContext'); };
```

The task page's buttons only claim the task and set its outcome — they change
nothing themselves. They go through `ACT_ApproveFromTask` / `ACT_ReturnFromTask`
rather than the built-in `complete_task` because a task has to be *assigned*
before it can be completed, and Mendix separates the users a task targets from
the one holding it (finding 44).

This shape was unusable for most of the build: mxcli wrote the activity as
`Workflows$CallMicroflowTask`, which Mendix 11.12.1 calls
`Workflows$CallMicroflowActivity`, so the app built clean and the runtime then
refused to load the model — the whole model, not just the workflow. The work had
to sit in the buttons instead. Fixed upstream in mxcli (finding 39), and the app
now uses the shape it always wanted.

**Mendix does not link a workflow to its context object**, so `Timesheet_Workflow`
does, set when the workflow starts. That association is how the task page finds
the week it is about — and why `ACT_SubmitWeek` refuses a week that already has
one running. It used to start a workflow every time it was pressed and overwrite
the association with the new instance; the displaced one kept running, its task
sat in the partner's inbox, and nothing could reach it, because both the queue
and the task page follow the association that had just been replaced.

**"Return with note" now means it.** The task page has a note field, the return
is refused without one, and `ACT_ReturnWeek` quotes it in the audit line the fee
earner reads:

> Week returned by the supervising partner — "Thursday looks like a double
> booking — please check M-2301."

The note and the buttons sit in a DataView over the *timesheet* rather than the
task, because Mendix hands a button the object of the DataView it is in: with the
buttons on the task, nothing typed would have reached the microflow. The task is
looked up from the week instead, by `DS_OpenTaskFor`.

### Verified end to end

| Step | Result |
|---|---|
| Boot on an empty database | 2 workflows started for the 2 submitted weeks, both tasks targeted at `j.haverkamp@vdh-law.nl`, due 3 days out |
| Partner opens **My tasks** | 2 tasks, with description and due date |
| Opens a task, clicks **Approve week** | task completed, workflow `Completed`, Pieter Ravensbergen's week `submitted` → `approved`, audit trail: *"Week approved by the supervising partner"* |
| Maartje de Vries submits her week | third workflow started, inbox goes 1 → 2, audit trail: *"Week submitted for approval — task assigned to the supervising partner"* |
| Partner clicks **Open task** in the approvals queue, then **Return with note** | task completed with the `Return` outcome, Fatima El Amrani's week → `returned` |

Final state: 2 workflows `Completed`, 1 `InProgress`, 1 open task.

## Styling

`theme/web/_vdh.scss` holds the design language — cream canvas, ink sidebar,
ox-blood accent, Source Serif headings, IBM Plex Sans body, IBM Plex Mono for
every figure, dense hairline tables. The fonts are vendored under
`theme/web/fonts/` so the app renders identically with no outbound request.

Two techniques worth knowing about when editing it:

- **Bucket classes.** A Mendix widget has no computed inline style, so any
  data-driven dimension (meter fill, bar height) is quantised to a 0–20 bucket in
  a microflow and `DynamicClasses` selects a generated `vdh-w-b*` / `vdh-h-b*`
  class.
- **`display: contents`.** A ListView nests each row four levels deep, which
  breaks layouts where the row must be a flex child (stacked bars, chart
  columns). The wrappers are collapsed inside `.vdh-chart` / `.vdh-stack`.

The sidebar's section labels (MY WORK / MANAGE / …) and the item badges are CSS
pseudo-elements: the Mendix navigation model has no group header or badge field.

### Formatting figures

Every number and date on these screens is a `Decimal` or a `DateTime`, and a
dynamictext bound straight to one renders `2.50000000`. Two mechanisms handle
that, and which applies is worth knowing before adding a column.

**A `format` block on the content parameter**, for anything the runtime's own
formatter can express — hours to two decimals, a date as `EEE d MMM`:

```mdl
dynamictext weHours (Content: '{1}', ContentParams: [{1} = Hours format (decimalPrecision: 2)])
```

**A precomputed `*Label` string**, for money. `groupDigits` follows the runtime
locale, which is `en_US`, so it produces `€ 9,142` where the design wants
`€ 9.142`; the microflow builds the caption and swaps the separator. Switching
the runtime to `nl_NL` is not the way out — it would render hours as `2,50`,
which the design does not use. The mixed convention the design specifies (a dot
for thousands in money, a dot for decimals in hours) is not expressible as one
locale.

Everything else that reads `*Label` — the week grid's day cells, the report
columns — is a *composed* caption rather than a formatted number: a middle dot
for an empty cell, `11.0 h` with its unit, `—` for a day outside the week. Those
are not formatting and stay in the microflow.

## Where this departs from the handoff, and why

- **The mockup's panels do not add up.** Its week grid totals 36.5 h with 32.0 h
  billable, while its side panels claim 33.5 billable and € 10.385. The app
  computes everything from the entries instead, so it shows 32.00 billable and
  € 9.142. The layout matches; the arithmetic is now self-consistent.
- **Rates.** The handoff's "my rate" column shows standard rates while its rate
  card shows negotiated ones. The app applies the negotiated rate (ABN Delta
  senior € 287, Rijnmond € 295, Kessler € 275), so those columns differ by design.
- **Only Maartje de Vries's week has entry detail.** The other eight timesheets
  carry submitted totals; their entries are outside the demo dataset.
- **Report figures are seeded snapshots** matching the handoff, not derived from
  4.182 hours of generated entries.

## Security

Production security level, three roles, and row-level access rules.

| Role | Sees | Can do |
|---|---|---|
| **FeeEarner** | My matters, Week timesheet, Time entry | Record, edit and submit **their own** time |
| **Partner** | + My tasks, Approvals, Monthly rollup, all three reports | Approve or return **their team's** weeks |
| **Administrator** | + Rate card | Maintain rates, close the period, manage users |

**Identity.** `Employee_Account` links a fee earner to the account they sign in
with. `DS_CurrentEmployee` resolves it from `[%CurrentUser%]`, so every "my"
screen follows the session rather than a hard-wired name.

**Row scoping** is XPath on the access rule, evaluated by the platform on each
read — not a filter in a datasource:

```
[TimeReg.Timesheet_Employee/TimeReg.Employee/TimeReg.Employee_Account = '[%CurrentUser%]']
```

and for a partner's team, one hop further through `Employee_Manager`.

**Member-level restrictions.** Cost rates are withheld from the fee-earner role
on `TimeReg.Role`, and the client billing address on `TimeReg.Client` — withheld
at the attribute, not by hiding a page.

**One caveat worth knowing.** MDL cannot set a microflow's *Apply entity access*
flag, so a microflow datasource is **not** constrained by the access rules
(finding 19 in [FINDINGS.md](FINDINGS.md)). `DS_TeamWeek` therefore scopes to the
signed-in partner's reports in the microflow itself, and says so in its
documentation. Lists fed by `database from …` are scoped by the rules as normal.

### Verified by signing in

| Account | Menu | Own week | Approval queue |
|---|---|---|---|
| m.devries@vdh-law.nl (fee earner) | 3 items | 36.5 h — hers | no access |
| p.ravensbergen@vdh-law.nl (fee earner) | 3 items | empty — cannot see Maartje's | no access |
| j.haverkamp@vdh-law.nl (partner) | 9 items | his own | his 9 reports |
| praktijkbeheer@vdh-law.nl (practice mgmt) | 10 items | none — no fee-earner record | firm-wide |

Pieter's empty week is the proof: he has no entries of his own in the demo
dataset, and the access rules stop him seeing anyone else's.

All demo accounts use the password `VdhDemo2026!`, shown on the sign-in page.
This is a prototype dataset, not a credential store.

`mxcli lint` now reports **no** `SEC001` findings for any `TimeReg` entity (the
38 remaining are in the Atlas / Administration / System marketplace modules).

## Not done

- **Strict XPath mode is off.** mxcli's linter recommends it (SEC005) but its
  parser has no command to set it — see finding 36. It needs Studio Pro.
- **No SSO.** The design's Entra ID and smartcard buttons are not implemented;
  the page uses the platform's local sign-in.
- **No escalation or delegation on the workflow.** The user task has a due date
  the engine tracks, but nothing acts when it passes. A boundary timer event is
  the place for it, and now that finding 39 is fixed its body could call a
  microflow like the outcome branches do — it is simply not built.
- **The approvals queue still shows every week.** Weeks without a running
  workflow (already approved, still draft) show an *Open task* button that does
  nothing. Hiding it needs a conditional-visibility expression across the
  association, which MDL-WIDGET13 does not allow — a precomputed `HasOpenTask`
  boolean on `Timesheet` would fix it.
- **No maintenance screens.** Clients, matters, employees, task codes and rate
  agreements exist only because the seed created them. There is no way to add a
  matter, take on a client or negotiate a rate from inside the app — the rate
  card renders an effective-dated history it has no way to add to.
- **No reopening a closed month.** `ACT_LockPeriod` is one-way. Practice
  management can close July and nobody, including them, can put it back.
- **Static controls.** The filter chips, `Export XLSX` and the report-set buttons
  are still presentational, and the segment counts beside them (`Approved 6`,
  `Rejected 1`, `Client agreements 12`) are string literals rather than counts.
  (‹ ›, `Copy last week`, `Add row` and `Edit` all work.)
- **No week or period picker.** You reach a week or a month by stepping to it.
  A date picker, or a "this week" button, would need a date-to-Monday
  conversion, and Mendix's `daysBetween` is unsigned (finding 50), so it is more
  care than it looks.
- **Role standard and cost rates are not versioned**, so those two columns of
  the rate card show today's figures in every month. Only the negotiated client
  matrix has a history.
- **A derived month is thinner than the seeded one.** `ACT_RecalculatePeriod`
  produces the five summaries the report screens read; the role-mix percentages
  on the per-customer report, the utilisation histogram and the timeliness bands
  are seeded decoration for July and come out empty for any other month.
- **The period chips on the work screens are static.** "Period Jul 2026 · open /
  Jun 2026 · locked" in the topbar of the week, entry, my-matters and approvals
  screens describes the firm's close status, not the report selection, and does
  not move.

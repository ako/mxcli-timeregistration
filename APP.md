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

## Screens

| Screen | URL | What it does |
|---|---|---|
| My matters | `/p/my-matters` | The fee earner's book of work, budget consumption, notices, WTD check |
| Week timesheet | `/p/week` | The week grid — matter × task rows, seven day columns, composition, value, audit trail; ‹ › move between weeks |
| Time entry | `/p/new-entry` | Records an entry; rate resolved from the client agreement on save |
| My tasks | `/p/my-tasks` | The approver's inbox — whatever the workflow engine has assigned them |
| Team approvals | `/p/approvals` | The partner's queue for a week, with the flagged entries to review |
| Monthly rollup | `/p/rollup` | Firm KPIs, hours by week/matter/role, the close checklist, WTD exceptions |
| Report · per customer | `/p/report-customer` | Approved time by client, role mix, realisation, statement distribution |
| Report · per matter | `/p/report-matter` | Project Aurora: task breakdown, team, burn vs budget |
| Report · per manager & employee | `/p/report-people` | Utilisation, value, cost and margin per fee earner |
| Rate card | `/p/rate-card` | Standard card and the negotiated client rate matrix, with the change log |

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

**Where the decision actually happens.** The natural shape is an outcome branch
that calls a microflow. It builds, and then the runtime refuses to load the
model: mxcli writes that activity as `Workflows$CallMicroflowTask`, which Mendix
11.12.1 calls `Workflows$CallMicroflowActivity`. `mx check` reports 0 errors
either way (finding 39 in [FINDINGS.md](FINDINGS.md)). So the outcome branches
are empty and the work happens on the way in: the task page's buttons call
`ACT_ApproveFromTask` / `ACT_ReturnFromTask`, which claim the task, run
`ACT_ApproveWeek` / `ACT_ReturnWeek`, and then `set task outcome` — which is
what completes the task and tells the engine which branch was taken. The
outcomes are still the workflow's; only the branch bodies moved.

**Mendix does not link a workflow to its context object**, so `Timesheet_Workflow`
does, set when the workflow starts. That association is how the task page finds
the week it is about.

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
  the engine tracks, but nothing acts when it passes. A boundary timer event
  would be the place — it needs an activity in its body, which runs into the
  same finding 39.
- **The approvals queue still shows every week.** Weeks without a running
  workflow (already approved, still draft) show an *Open task* button that does
  nothing. Hiding it needs a conditional-visibility expression across the
  association, which MDL-WIDGET13 does not allow — a precomputed `HasOpenTask`
  boolean on `Timesheet` would fix it.
- **Static controls.** The filter chips, `Export XLSX` and the report-set buttons
  are still presentational. (‹ ›, `Copy last week` and `Add row` now work.)
- **Reports are still monthly and fixed.** The rollup and the three report
  screens read July 2026 snapshots; only the week screens follow the selection.
- **No week picker.** You reach a week by stepping to it. A date picker, or a
  "this week" button, would need a date-to-Monday conversion, and Mendix's
  `daysBetween` is unsigned (finding 50), so it is more care than it looks.

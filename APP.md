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
| Week timesheet | `/p/week` | The week grid — matter × task rows, seven day columns, composition, value, audit trail |
| Time entry | `/p/new-entry` | Records an entry; rate resolved from the client agreement on save |
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
  disagree.
- `DS_WeekRows` pivots the week's entries onto matter × task rows with seven day
  columns; `DS_WeekTotals` produces the day-total band.
- `ACT_SubmitWeek` / `ACT_ApproveWeek` / `ACT_ReturnWeek` move the week's status
  and append to its audit trail. `ACT_LockPeriod` closes the period.

Verified end to end: recording 3.25 h on Wednesday moved that day 8.00 → 11.25,
the week 36.5 → 39.8, and the value € 9.142 → € 10.036 — exactly 3.25 × € 275,
the Kessler blended rate picked up from the rate agreement.

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

## Not done

- **Security is off.** No module roles or entity access rules — `mxcli lint`
  reports 69 SEC001 warnings for that reason. The design's sign-in screen
  (Entra ID / smartcard) is not implemented; the acting user is hard-wired to
  Maartje de Vries in `DS_CurrentEmployee`.
- **Static controls.** Week navigation (‹ ›), the filter chips, `Copy last week`,
  `Add row`, `Export XLSX` and the report-set buttons are presentational.
- **Fixed period.** The screens are pinned to week 30 / July 2026 rather than
  driven by the current date.

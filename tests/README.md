# Regression suite

A browser suite that drives the running app the way a user does — signing in as
each of the three roles, walking the week, submitting and approving a timesheet,
moving the period, reading the rate card — and then checks the database behind
it. The UI can be made to look right by a page that reads the wrong thing, so
the assertions that matter most are the ones that go behind the screen.

It exists so a later session can prove the app still works rather than take an
earlier session's word for it.

## Running it

```bash
bash tests/reset.sh     # empty database, restart, wait for the seed
node tests/run.mjs      # the whole suite, ~7 minutes
node tests/run.mjs week period    # only specs whose filename matches
```

`reset.sh --stop` just stops the app.

Nothing to install: the suite uses the `playwright` and Chromium that
`scripts/setup-tools.sh` already puts in place, and talks to PostgreSQL through
`psql`. Two environment variables are honoured, `APP_URL` (default
`http://127.0.0.1:8080`) and `CHROMIUM_PATH`.

The runner exits non-zero if anything failed.

## Why it needs a reset first

The specs mutate data — they submit weeks, approve them, copy rows, open new
months, and the last one closes July — so they assume the seeded dataset and run
in filename order. `00-pristine.spec.mjs` is a guard: it checks the seeded row
counts and aborts the run rather than reporting a page full of failures that are
really leftovers from the previous pass.

## What each spec covers

| Spec | What it proves |
| --- | --- |
| `00-pristine` | the database is the seeded one — 9 timesheets, 2 running workflows, 11 accounts, one week, July open and underived |
| `01-security` | menus differ by role (3 / 9 / 10 items), the task inbox is refused to a fee earner, and one fee earner cannot see another's rows |
| `02-week` | week navigation, a week being created the first time it is opened, copy-last-week (and copying twice being a no-op), and a logged 2,50 h reaching the total, the value panel and the composition bar |
| `03-workflow` | submitting starts a real `System.Workflow`, the user task lands in the supervising partner's inbox with its description and due date, and approve / return drive the workflow to its outcome |
| `04-period` | one period selection shared by all four report screens, July's seeded snapshot left alone, a newly opened month created and summarised from the entry table |
| `05-ratecard` | the card is effective-dated: July quotes Rijnmond after the indexation, June before it, April predates the Kessler agreement entirely, and the change log truncates to the date being viewed |
| `06-screens` | every one of the ten screens renders its own content with no client-side error, the entry form arrives filled in, and the month close — which nothing else exercises — locks the period for practice management but is absent for a partner |

## Notes on the harness

`lib/harness.mjs` is deliberately small — `check` / `checkEqual` collect
assertions, `sql` / `sqlValue` / `sqlBool` query the database, `withBrowser`
opens a page and collects console errors.

`signIn` deletes the `system$session` rows before signing in. Clearing cookies
is not enough: it orphans the session server-side rather than ending it, the
orphan still counts against the trial licence's concurrent-session cap (finding
35), and once the cap is hit sign-in quietly fails and every later assertion
reports a 401 as though the app were broken. There is no `/logout` endpoint to
use instead — it answers 404.

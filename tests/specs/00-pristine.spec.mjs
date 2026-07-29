/**
 * The specs that follow submit weeks, approve them and open new months. They
 * only mean anything against the seeded dataset, so this refuses to let the run
 * continue against a database somebody has already been through.
 */
import { check, checkEqual, sqlValue } from '../lib/harness.mjs';

export const name = 'Pristine seeded database';
export const abortOnFailure = true;

export async function run() {
  checkEqual('9 timesheets seeded', sqlValue('select count(*) from "timereg$timesheet"'), '9');
  checkEqual('2 approval workflows started at boot', sqlValue('select count(*) from "system$workflow"'), '2');
  checkEqual('both still in progress',
    sqlValue(`select count(*) from "system$workflow" where state = 'InProgress'`), '2');
  checkEqual('11 accounts', sqlValue('select count(*) from "administration$account"'), '11');
  checkEqual('July 2026 is the seeded, underived period',
    sqlValue(`select coalesce(isderived::text,'f') from "timereg$period" where name = 'Jul 2026'`), 'false');

  const weeks = sqlValue('select count(distinct weekstart) from "timereg$timesheet"');
  check('only the seeded week exists', weeks === '1', `found ${weeks} distinct weeks — run tests/reset.sh`);
}

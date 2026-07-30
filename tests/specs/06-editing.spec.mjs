/**
 * Correcting recorded time, and the three things that used to go unchecked.
 *
 * Until the entry form could open an entry that already existed, a typo in
 * Monday's hours was permanent — and returning a week was close to pointless,
 * since the fee earner could not act on the note. The guards go with it: an
 * entry that can be edited is one that can be edited *around* a submission or a
 * closed month, so saving, editing and deleting all ask the same question.
 */
import {
  check, checkEqual, withBrowser, signIn, open, bodyText, sql, sqlValue, sleep,
} from '../lib/harness.mjs';

export const name = 'Editing — correcting an entry, and the guards on it';

/** Maartje's timesheets, whatever the earlier specs did with them. */
const HER_WEEKS = `select t.id from "timereg$timesheet" t
  join "timereg$employee" e on e.id = t."timereg$timesheet_employee"
  where e.email = 'm.devries@vdh-law.nl'`;

const herHours = () => sqlValue(`select sum(recordedhours) from "timereg$timesheet"
  where id in (${HER_WEEKS})`);

/** Open user tasks whose workflow no timesheet points at — nothing can reach them. */
const orphanedTasks = () => sqlValue(
  `select count(*) from "system$workflowusertask" ut
   join "system$workflowusertask_workflow" uw on uw."system$workflowusertaskid" = ut.id
   where ut.endtime is null
     and not exists (select 1 from "timereg$timesheet" t
                     where t."timereg$timesheet_workflow" = uw."system$workflowid")`);

export async function run() {
  // The workflow spec leaves her weeks wherever its own flow put them, and this
  // one is about a week still in the fee earner's hands.
  sql(`update "timereg$timesheet" set status = 'Draft', statuslabel = 'draft'
       where id in (${HER_WEEKS})`);

  await withBrowser(async (page, errors) => {
    await signIn(page, 'm.devries@vdh-law.nl');
    await open(page, '/p/week');

    // --- the entries behind the grid ---------------------------------------
    const rows = (await page.$$('.mx-name-weekEntries .vdh-trow')).length;
    check('the week lists the entries behind its grid', rows > 0, `${rows} rows`);
    const editButtons = await page.getByRole('button', { name: 'Edit', exact: true }).count();
    checkEqual('one edit affordance per entry', editButtons, rows);

    // --- editing one -------------------------------------------------------
    const hoursBefore = Number(herHours());
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await sleep(2600);
    const onForm = await bodyText(page);
    check('which opens the entry, filled in', onForm.includes('Edit time entry'));
    check('showing what it was recorded at', onForm.includes('As recorded'));

    const oldHours = Number(await (await page.$$('input.form-control'))[1].inputValue());
    await (await page.$$('input.form-control'))[1].fill('9.75');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await sleep(3200);

    check('saving returns to the week', (await bodyText(page)).includes('Entries this week'));
    checkEqual('the corrected entry is on the entry table',
      sqlValue(`select count(*) from "timereg$timeentry" where hours = 9.75`), '1');
    const expected = (hoursBefore - oldHours + 9.75).toFixed(2);
    checkEqual('and the week total is recomputed from it', Number(herHours()).toFixed(2), expected);

    // --- removing one ------------------------------------------------------
    const entriesBefore = Number(sqlValue('select count(*) from "timereg$timeentry"'));
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await sleep(2600);
    await page.getByRole('button', { name: 'Remove entry', exact: true }).click();
    await sleep(3200);
    checkEqual('removing an entry takes it off the table',
      sqlValue('select count(*) from "timereg$timeentry"'), String(entriesBefore - 1));
    check('and leaves a line in the audit trail, since the grid simply has less in it',
      sql(`select description from "timereg$auditentry"
           where description like 'Entry removed%'`).length > 0);

    // --- submitting twice --------------------------------------------------
    // This is the one that orphaned a task: the second `call workflow` replaced
    // the association, and the first instance kept running with nothing able to
    // reach it.
    const wfBefore = Number(sqlValue('select count(*) from "system$workflow"'));
    await open(page, '/p/week');
    await page.getByRole('button', { name: 'Submit week', exact: true }).click();
    await sleep(3500);
    checkEqual('submitting starts one workflow',
      sqlValue('select count(*) from "system$workflow"'), String(wfBefore + 1));

    // Measured here rather than before the first submit: the fixture above put a
    // week that already had a running workflow back into draft, which is a thing
    // only a test can do, and re-submitting it strands that instance. The claim
    // is about the second press.
    const orphansBefore = orphanedTasks();
    await page.getByRole('button', { name: 'Submit week', exact: true }).click();
    await sleep(3000);
    checkEqual('submitting again starts none',
      sqlValue('select count(*) from "system$workflow"'), String(wfBefore + 1));
    check('and says why', (await bodyText(page)).includes('already with your supervising partner'));
    checkEqual('so the second press leaves no task unreachable', orphanedTasks(), orphansBefore);

    // --- a submitted week is out of the fee earner's hands ------------------
    await open(page, '/p/week');
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await sleep(2600);
    await (await page.$$('input.form-control'))[1].fill('1.25');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await sleep(2600);
    const refused = await bodyText(page);
    check('a submitted week cannot be edited behind the approver',
      refused.includes('with your supervising partner for approval'));
    check('and the form stays put, so the correction is not lost with the warning',
      refused.includes('Edit time entry'));
    checkEqual('nothing was written', sqlValue(
      `select count(*) from "timereg$timeentry" where hours = 1.25`), '0');

    // --- a closed month is out of everyone's hands -------------------------
    sql(`update "timereg$timesheet" set status = 'Draft', statuslabel = 'draft'
         where id in (${HER_WEEKS})`);
    sql(`update "timereg$period" set status = 'Locked' where name = 'Jul 2026'`);

    const n = sqlValue('select count(*) from "timereg$timeentry"');
    await open(page, '/p/new-entry');
    await (await page.$$('input.form-control'))[1].fill('3.00');
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await sleep(3000);
    checkEqual('a closed month refuses new time',
      sqlValue('select count(*) from "timereg$timeentry"'), n);
    check('naming the period, rather than failing silently',
      (await bodyText(page)).includes('closed. Time can no longer be recorded'));

    await open(page, '/p/week');
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await sleep(2600);
    await (await page.$$('input.form-control'))[1].fill('8.25');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await sleep(2600);
    check('and refuses a correction to time already reported on',
      (await bodyText(page)).includes('closed. Time can no longer be recorded'));
    checkEqual('nothing written there either', sqlValue(
      `select count(*) from "timereg$timeentry" where hours = 8.25`), '0');

    await page.getByRole('button', { name: 'Remove entry', exact: true }).click();
    await sleep(2600);
    checkEqual('nor a deletion around the restriction',
      sqlValue('select count(*) from "timereg$timeentry"'), n);

    check('no client error anywhere in that', errors.length === 0, errors[0] || '');
  });

  // The screens spec closes July itself and checks it was open first.
  sql(`update "timereg$period" set status = 'Open' where name = 'Jul 2026'`);
}

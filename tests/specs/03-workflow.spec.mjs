/**
 * The approval workflow, end to end.
 *
 * The assertions that matter are the database ones. The task page's buttons only
 * claim the task and set its outcome — the status change and the audit row are
 * written by ACT_ApproveWeek / ACT_ReturnWeek, and the only thing that calls
 * those is the workflow's own outcome branch. So if the week moves, the branch
 * ran.
 */
import {
  check, checkEqual, withBrowser, signIn, open, bodyText, sql, sqlValue, sleep,
} from '../lib/harness.mjs';

const inbox = page => page.$$('.vdh-trow .vdh-w-96');

export const name = 'Workflow — submit, approve, return';

export async function run() {
  await withBrowser(async page => {
    // --- a fee earner submits ----------------------------------------------
    await signIn(page, 'm.devries@vdh-law.nl');
    await open(page, '/p/week');
    await page.getByRole('button', { name: 'Submit week', exact: true }).first().click();
    await sleep(3500);

    checkEqual('submitting starts a workflow', sqlValue('select count(*) from "system$workflow"'), '3');
    checkEqual('and records it on the week',
      sqlValue(`select count(*) from "timereg$timesheet" where "timereg$timesheet_workflow" is not null`), '3');
    check('with an audit line',
      sql(`select description from "timereg$auditentry" where description like 'Week submitted%'`).length > 0);

    // --- the partner's inbox ------------------------------------------------
    await signIn(page, 'j.haverkamp@vdh-law.nl');
    await open(page, '/p/my-tasks');
    const before = (await inbox(page)).length;
    checkEqual('the task lands in the supervising partner\'s inbox', before, 3);
    check('targeted at him, not at anyone else',
      sqlValue(`select count(distinct u.name) from "system$workflowusertask_targetusers" j
                join "system$user" u on u.id = j."system$userid"`) === '1');

    const bodyBefore = await bodyText(page);
    check('the task carries its description', bodyBefore.includes('Review the recorded hours'));
    check('and a due date', /Due/i.test(bodyBefore) || bodyBefore.includes('/2026'));

    // --- approve ------------------------------------------------------------
    await page.getByRole('button', { name: 'Open', exact: true }).first().click();
    await sleep(3000);
    check('the task page shows the week under review', (await bodyText(page)).includes('Week under review'));

    await page.getByRole('button', { name: 'Approve week', exact: true }).click();
    await sleep(4000);

    checkEqual('the workflow completes', sqlValue(`select count(*) from "system$workflow" where state = 'Completed'`), '1');
    checkEqual('a week moved to approved',
      sqlValue(`select count(*) from "timereg$timesheet" t
                where t."timereg$timesheet_workflow" is not null and t.statuslabel = 'approved'`), '1');
    check('and the outcome branch wrote the audit row',
      sql(`select description from "timereg$auditentry" where description like 'Week approved%'`).length > 0);

    await open(page, '/p/my-tasks');
    checkEqual('the task leaves the inbox', (await inbox(page)).length, before - 1);

    // --- return, from the approvals queue -----------------------------------
    await open(page, '/p/approvals');
    const openTask = page.getByRole('button', { name: 'Open task', exact: true });
    check('the queue routes into the task rather than approving in place', (await openTask.count()) > 0);

    let opened = false;
    for (let i = 0; i < await openTask.count(); i++) {
      await openTask.nth(i).click();
      await sleep(2600);
      if ((await bodyText(page)).includes('Week under review')) { opened = true; break; }
      await open(page, '/p/approvals');
    }
    check('a queued week opens its task', opened);

    if (opened) {
      // The button has always said "Return with note". It now means it.
      await page.getByRole('button', { name: 'Return with note', exact: true }).click();
      await sleep(2500);
      check('returning without a note is refused',
        (await bodyText(page)).includes('Say what needs correcting'));
      checkEqual('and nothing moves', sqlValue(
        `select count(*) from "timereg$timesheet" where statuslabel = 'returned'`), '0');

      const note = page.locator('.mx-name-wtNote textarea');
      await note.click();
      await note.fill('Thursday looks like a double booking — please check M-2301.');
      await note.press('Tab');
      await sleep(600);
      await page.getByRole('button', { name: 'Return with note', exact: true }).click();
      await sleep(4000);
      checkEqual('returning moves the week back',
        sqlValue(`select count(*) from "timereg$timesheet" where statuslabel = 'returned'`), '1');
      check('through the Return branch',
        sql(`select description from "timereg$auditentry" where description like 'Week returned%'`).length > 0);
      check('and the note reaches the fee earner, quoted in the audit trail',
        sql(`select description from "timereg$auditentry"
             where description like '%double booking%'`).length > 0);
      checkEqual('and that workflow completes too',
        sqlValue(`select count(*) from "system$workflow" where state = 'Completed'`), '2');
    }
  });
}

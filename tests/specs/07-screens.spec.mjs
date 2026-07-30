/**
 * Every screen renders, with content, and without a client-side error.
 *
 * This is the spec that covers what the flow specs do not: my matters, the
 * entry form's fields, the report bodies and the month-close panel. It is
 * deliberately shallow — it asserts that each screen is alive and showing its
 * own data, not that every figure on it is right. The report figures are seeded
 * snapshots; APP.md says which ones are derived and which are not.
 */
import {
  check, checkEqual, withBrowser, signIn, open, bodyText, text, sql, sqlValue, sleep,
} from '../lib/harness.mjs';

const screens = [
  // path,                   a phrase only that screen shows,        who sees it
  ['/p/my-matters',          'My matters',                            'fee'],
  ['/p/week',                'Week composition',                      'fee'],
  ['/p/new-entry',           'Rules applied',                         'fee'],
  ['/p/my-tasks',            'Assigned to me by the workflow engine',  'partner'],
  ['/p/approvals',           'The week shown on your own timesheet',   'partner'],
  ['/p/rollup',              'Month close',                            'partner'],
  ['/p/report-customer',     'Report distribution',                    'partner'],
  ['/p/report-matter',       'Hours & value by task code',             'partner'],
  ['/p/report-people',       'Target utilisation',                     'partner'],
  ['/p/rate-card',           'Legend & rules',                         'admin'],
];

const users = {
  fee: 'm.devries@vdh-law.nl',
  partner: 'j.haverkamp@vdh-law.nl',
  admin: 'praktijkbeheer@vdh-law.nl',
};

export const name = 'Screens — every page renders, with content and no client error';

export async function run() {
  await withBrowser(async (page, errors) => {
    for (const who of ['fee', 'partner', 'admin']) {
      await signIn(page, users[who]);
      for (const [path, phrase, owner] of screens.filter(s => s[2] === who)) {
        errors.length = 0;
        await open(page, path);
        const body = await bodyText(page);
        check(`${path} renders its own content`, body.includes(phrase), `looked for "${phrase}"`);
        check(`${path} raises no client error`, errors.length === 0, errors[0] || '');
      }
    }

    // --- the entry form's fields, which no flow spec touches ----------------
    await signIn(page, users.fee);
    await open(page, '/p/new-entry');
    const values = await page.$$eval('input', els => els.map(e => e.value).filter(Boolean));
    check('the entry form arrives with a matter picked', values.some(v => /\w{4,}/.test(v)), JSON.stringify(values));
    check('and a date inside the week being viewed', values.some(v => /\d{1,2}\/\d{1,2}\/\d{4}/.test(v)),
      JSON.stringify(values));
    check('with the narrative field present', (await page.$$('textarea')).length > 0);
    // Mendix renders an enumeration as its own combobox widget rather than a
    // native <select>; the current value sits in the widget's input.
    const combos = await page.$$eval('input.widget-combobox-input', els => els.map(e => e.value));
    check('and a billability chooser', combos.includes('Billable'), JSON.stringify(combos));

    // --- my matters carries the fee earner's book of work -------------------
    await open(page, '/p/my-matters');
    check('my matters lists matters', (await page.$$('.vdh-trow')).length > 0);

    // --- the month close, which nothing else exercises ----------------------
    // Closing the month is practice management's, not a partner's: ACT_LockPeriod
    // is granted to Administrator only, so the button is absent for everyone
    // else. That is the assertion worth making about the partner's rollup.
    await signIn(page, users.partner);
    await open(page, '/p/rollup');
    check('the close checklist is filled in for the partner',
      (await bodyText(page)).includes('All timesheets submitted'));
    check('but he cannot close the month himself',
      !(await bodyText(page)).includes('Lock period'));

    await signIn(page, users.admin);
    await open(page, '/p/rollup');
    checkEqual('the period is open before the close', sqlValue(
      `select status from "timereg$period" where name = 'Jul 2026'`), 'Open');

    await page.getByRole('button', { name: 'Lock period & release reports', exact: true }).click();
    await sleep(3500);
    checkEqual('locking the period closes it', sqlValue(
      `select status from "timereg$period" where name = 'Jul 2026'`), 'Locked');

    // A user who has never navigated has no stored selection, so DS_SelectedPeriod
    // falls back to the earliest open period — and once the firm has closed every
    // month, there isn't one. It has to show the last month instead of going
    // blank, because the ‹ › buttons live inside that same dataview and go with
    // it. Locking the lot is the only way to reach that branch.
    sql(`update "timereg$period" set status = 'Locked'`);
    sql('delete from "timereg$periodselection"');
    await open(page, '/p/rollup');
    const nav = (await text(page, '.vdh-periodnav')).replace(/\s+/g, ' ');
    check('and a firm with nothing left open still lands on its last month, navigable',
      nav.includes('Aug 2026') && nav.includes('‹') && nav.includes('›'), JSON.stringify(nav));
  });
}

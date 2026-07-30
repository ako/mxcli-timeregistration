/**
 * Multi-week: navigating, creating a week by opening it, copying rows, and
 * recording time.
 *
 * Leaves Maartje de Vries on week 31 with six copied rows and 2.50 h recorded;
 * the workflow spec that follows submits from there.
 */
import {
  check, checkEqual, withBrowser, signIn, open, gridRows, text, sql, sqlValue, sleep,
} from '../lib/harness.mjs';

const range = page => text(page, '.vdh-mono.vdh-strong');
const total = page => text(page, '.vdh-tfoot .vdh-w-80');
const num = s => parseFloat(s || '0');

export const name = 'Weeks — navigation, creation on open, copy last week';

export async function run() {
  await withBrowser(async page => {
    await signIn(page, 'm.devries@vdh-law.nl');
    await open(page, '/p/week');

    check('opens on the seeded week', (await range(page)).includes('Week 30'), await range(page));
    checkEqual('with its recorded hours', num(await total(page)), 36.5);
    const seededRows = await gridRows(page);
    check('and its rows', seededRows > 0);

    const dayHeaders = await page.$$eval('.vdh-thead .vdh-w-72', els => els.map(e => e.textContent.trim()));
    checkEqual('day headers follow the week', dayHeaders[0], 'Mon 20');
    checkEqual('through to Sunday', dayHeaders[6], 'Sun 26');

    // --- forward into a week that has never existed -------------------------
    await page.getByRole('button', { name: '›', exact: true }).click();
    await sleep(2600);
    check('› moves on a week', (await range(page)).includes('Week 31'), await range(page));
    checkEqual('the new week is empty', await gridRows(page), 0);
    checkEqual('opening it created it',
      sqlValue(`select count(*) from "timereg$timesheet" where weeknumber = 31`), '1');

    // --- copy last week -----------------------------------------------------
    await page.getByRole('button', { name: 'Copy last week', exact: true }).click();
    await sleep(2800);
    checkEqual('copy brings last week\'s rows over', await gridRows(page), seededRows);
    checkEqual('with no hours', num(await total(page)), 0);

    const copied = sql(`select m.code, tc.code from "timereg$timeentry" e
      join "timereg$timesheet" t on t.id = e."timereg$timeentry_timesheet"
      join "timereg$matter" m on m.id = e."timereg$timeentry_matter"
      join "timereg$taskcode" tc on tc.id = e."timereg$timeentry_taskcode"
      where t.weeknumber = 31 order by 1, 2`);
    const source = sql(`select distinct m.code, tc.code from "timereg$timeentry" e
      join "timereg$timesheet" t on t.id = e."timereg$timeentry_timesheet"
      join "timereg$matter" m on m.id = e."timereg$timeentry_matter"
      join "timereg$taskcode" tc on tc.id = e."timereg$timeentry_taskcode"
      where t.weeknumber = 30 order by 1, 2`);
    checkEqual('the same matter/task pairs, exactly', JSON.stringify(copied), JSON.stringify(source));

    await page.getByRole('button', { name: 'Copy last week', exact: true }).click();
    await sleep(2800);
    checkEqual('copying twice is a no-op', await gridRows(page), seededRows);

    // --- back, and the seeded week is untouched -----------------------------
    await page.getByRole('button', { name: '‹', exact: true }).click();
    await sleep(2600);
    check('‹ goes back', (await range(page)).includes('Week 30'));
    checkEqual('the seeded week is unchanged', num(await total(page)), 36.5);

    await page.getByRole('button', { name: '›', exact: true }).click();
    await sleep(2600);
    checkEqual('and the new week kept its rows', await gridRows(page), seededRows);

    // --- record time into it ------------------------------------------------
    await page.getByRole('button', { name: 'Log time', exact: true }).click();
    await sleep(2800);
    await page.fill('.vdh-hours-input input', '2.5');
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await sleep(3500);
    await page.getByRole('button', { name: 'Week timesheet', exact: true }).click();
    await sleep(2600);
    checkEqual('recording 2.50 h moves the week total', num(await total(page)), 2.5);

    // 2.5 h on the Kessler patent matter at the blended rate the card quotes.
    checkEqual('valued at the rate the agreement carries',
      sqlValue(`select round(sum(e.amountvalue)) from "timereg$timeentry" e
                join "timereg$timesheet" t on t.id = e."timereg$timeentry_timesheet"
                where t.weeknumber = 31`), '688');

    // --- the panels under the grid are derived, not seeded ------------------
    checkEqual('the composition bar is rebuilt from the entries',
      sqlValue(`select count(c.id) from "timereg$weekcomposition" c
                join "timereg$timesheet" t on t.id = c."timereg$weekcomposition_timesheet"
                where t.weeknumber = 31`), '1');
    check('and the value panel names the client and its rate',
      (sqlValue(`select v.label from "timereg$weekvalueline" v
                 join "timereg$timesheet" t on t.id = v."timereg$weekvalueline_timesheet"
                 where t.weeknumber = 31`) || '').includes('275'));
  });
}

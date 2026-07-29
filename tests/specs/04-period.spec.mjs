/**
 * Period-aware reporting: the selection is shared across the four report
 * screens, July keeps its seeded snapshot, and any other month is created and
 * summarised from the entry table when it is opened.
 */
import {
  check, checkEqual, withBrowser, signIn, open, text, sqlValue, sqlBool, sleep,
} from '../lib/harness.mjs';

const period = page => text(page, '.vdh-periodnav .vdh-mono', '?');
const kpis = page => page.$$eval('.vdh-kpi-value', els => els.map(e => e.textContent.trim()));

export const name = 'Periods — the reports follow one selection';

export async function run() {
  await withBrowser(async page => {
    await signIn(page, 'j.haverkamp@vdh-law.nl');
    await open(page, '/p/rollup');

    checkEqual('the rollup opens on the period the firm has to close', await period(page), 'Jul 2026');
    const july = await kpis(page);
    check('showing the seeded figures', july[0] === '4.182', july[0]);

    // --- forward into a month nobody has reported on ------------------------
    await page.getByRole('button', { name: '›', exact: true }).click();
    await sleep(3000);
    checkEqual('› opens the next month', await period(page), 'Aug 2026');
    checkEqual('creating it', sqlValue(`select count(*) from "timereg$period" where name = 'Aug 2026'`), '1');
    check('and marking it derived, so July\'s snapshot is never recomputed',
      sqlBool(`select isderived from "timereg$period" where name = 'Aug 2026'`) === true);

    const august = await kpis(page);
    check('with its own figures, not July\'s', august[0] !== july[0], `${august[0]} vs ${july[0]}`);

    // --- the selection is shared -------------------------------------------
    await open(page, '/p/report-customer');
    checkEqual('the per-customer report follows it', await period(page), 'Aug 2026');

    await page.getByRole('button', { name: '‹', exact: true }).click();
    await sleep(3000);
    checkEqual('and can move it back', await period(page), 'Jul 2026');

    await open(page, '/p/report-people');
    checkEqual('the per-people report follows in turn', await period(page), 'Jul 2026');
    check('with rows for the month', (await page.$$('.vdh-trow')).length > 0);

    await open(page, '/p/rollup');
    checkEqual('and the rollup is back where it started', await period(page), 'Jul 2026');
    checkEqual('July\'s seeded figures intact', (await kpis(page))[0], july[0]);

    // --- a derived month reports real numbers -------------------------------
    // Week 31 sits in July, so August is genuinely empty until something is
    // recorded into it; what matters is that it was summarised, not seeded.
    checkEqual('the derived month has a KPI row of its own',
      sqlValue(`select count(*) from "timereg$periodstat" s
                join "timereg$period" p on p.id = s."timereg$periodstat_period"
                where p.name = 'Aug 2026'`), '1');
  });
}

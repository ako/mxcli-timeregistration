/**
 * Security, checked by signing in rather than by reading the matrix.
 *
 * The row-level rules are the ones worth testing: a fee earner seeing an empty
 * week is the proof, because he has no entries of his own and the access rules
 * stop him seeing anyone else's.
 */
import { check, checkEqual, withBrowser, signIn, open, menuItems, bodyText, gridRows } from '../lib/harness.mjs';

export const name = 'Security — roles, menus and row scoping';

export async function run() {
  await withBrowser(async page => {
    // --- fee earner ---------------------------------------------------------
    await signIn(page, 'm.devries@vdh-law.nl');
    const feeMenu = await menuItems(page);
    checkEqual('fee earner sees 3 menu items', feeMenu.length, 3);
    check('and none of them is a report', !feeMenu.some(m => /report|rollup|rate|approv|task/i.test(m)),
      feeMenu.join(', '));

    await open(page, '/p/week');
    check('her own week has entries', (await gridRows(page)) > 0);

    await open(page, '/p/my-tasks');
    check('the task inbox is refused to a fee earner',
      !(await bodyText(page)).includes('Assigned to me by the workflow engine'));

    // --- a fee earner with no time of his own -------------------------------
    await signIn(page, 'p.ravensbergen@vdh-law.nl');
    await open(page, '/p/week');
    checkEqual('a colleague with no entries sees an empty grid, not someone else\'s', await gridRows(page), 0);

    // --- partner ------------------------------------------------------------
    await signIn(page, 'j.haverkamp@vdh-law.nl');
    const partnerMenu = await menuItems(page);
    checkEqual('partner sees 9 menu items', partnerMenu.length, 9);
    check('including the task inbox', partnerMenu.includes('My tasks'));
    check('but not the rate card', !partnerMenu.includes('Rate card'), partnerMenu.join(', '));

    await open(page, '/p/approvals');
    check('the approval queue lists his reports', (await page.$$('.vdh-trow .vdh-w-120')).length > 0);

    // --- practice management ------------------------------------------------
    await signIn(page, 'praktijkbeheer@vdh-law.nl');
    const adminMenu = await menuItems(page);
    checkEqual('practice management sees all 10', adminMenu.length, 10);
    check('including the rate card', adminMenu.includes('Rate card'));
  });
}

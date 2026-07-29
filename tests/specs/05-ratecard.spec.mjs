/**
 * The rate card is a history, not a snapshot.
 *
 * The seeded agreements follow the card's own change log: Rijnmond indexed
 * +2,1% on 1 July, Kessler's blended rate introduced on 14 May. Stepping back a
 * month has to show the card as it stood then.
 */
import {
  check, checkEqual, withBrowser, signIn, open, text, bodyText, sleep,
} from '../lib/harness.mjs';

const period = page => text(page, '.vdh-periodnav .vdh-mono', '?');

/** One row per role: [role, ABN, Rijnmond, Kessler, Nieuw A., Bergland]. */
async function matrix(page) {
  return page.$$eval('.vdh-trow', trs => trs.map(tr => {
    const cells = [...tr.querySelectorAll('.vdh-w-120')].map(e => e.textContent.trim());
    const role = tr.querySelector('.vdh-cell-title');
    return role && cells.length === 5 ? [role.textContent.trim(), ...cells] : null;
  }).filter(Boolean));
}
const senior = rows => rows.find(r => r[0] === 'Senior Associate') || [];

export const name = 'Rate card — effective-dated agreements';

export async function run() {
  await withBrowser(async page => {
    await signIn(page, 'praktijkbeheer@vdh-law.nl');
    await open(page, '/p/rate-card');

    checkEqual('opens on the current period', await period(page), 'Jul 2026');
    const july = senior(await matrix(page));
    checkEqual('July quotes Rijnmond after the indexation', july[2], '€ 295');
    checkEqual('and the Kessler blended rate', july[3], '€ 275');
    check('the card says which date it is quoting', (await bodyText(page)).includes('31 Jul 2026'));

    await page.getByRole('button', { name: '‹', exact: true }).click();
    await sleep(2800);
    checkEqual('‹ steps back a month', await period(page), 'Jun 2026');
    const june = senior(await matrix(page));
    checkEqual('June quotes Rijnmond before the +2,1%', june[2], '€ 289');
    check('and dates itself accordingly', (await bodyText(page)).includes('30 Jun 2026'));

    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '‹', exact: true }).click();
      await sleep(2800);
    }
    checkEqual('two more steps back', await period(page), 'Apr 2026');
    const april = senior(await matrix(page));
    checkEqual('April predates the Kessler agreement entirely', april[3], '—');
    checkEqual('while Rijnmond still shows its pre-indexation rate', april[2], '€ 289');

    const aprilBody = await bodyText(page);
    check('and the change log does not yet know about July\'s indexation',
      !/indexed \+2,1%/.test(aprilBody));
    check('though it does show the changes already made', /NGO discount/.test(aprilBody));

    // Put the selection back so a later spec is not surprised by it.
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '›', exact: true }).click();
      await sleep(2800);
    }
    checkEqual('and forward again to July', await period(page), 'Jul 2026');
    check('where the log does mention it', /indexed \+2,1%/.test(await bodyText(page)));
  });
}

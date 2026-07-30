/**
 * A very small test harness.
 *
 * Deliberately dependency-free: it uses the `playwright` library and the
 * Chromium that scripts/setup-tools.sh already guarantees, so the suite runs in
 * a fresh session with nothing to install. That is the same bargain the rest of
 * this repo makes — everything re-establishes itself from the bootstrap script.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/**
 * Playwright is installed globally, and this suite has no package.json of its
 * own, so a bare `import 'playwright'` resolves only if something has linked it
 * into tests/node_modules. Resolve it from the interpreter's own global module
 * root instead — <prefix>/lib/node_modules, the directory `npm -g` installs
 * into — and fall back to ordinary resolution if the layout is unusual.
 */
const { chromium } = (() => {
  const globalBase = join(dirname(dirname(process.execPath)), 'lib', 'resolve-from-here.cjs');
  for (const base of [globalBase, import.meta.url]) {
    try { return createRequire(base)('playwright'); } catch { /* try the next one */ }
  }
  throw new Error('playwright is not installed — run scripts/setup-tools.sh');
})();

export const BASE = process.env.APP_URL || 'http://127.0.0.1:8080';
export const PASSWORD = 'VdhDemo2026!';
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Assertions collected by the current spec. */
let current = null;

export function check(label, condition, detail = '') {
  const ok = condition === true;
  current.results.push({ label, ok, detail: ok ? '' : detail });
  return ok;
}

export function checkEqual(label, actual, expected) {
  return check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * A query against the app's database.
 *
 * The UI can be made to look right by a page that reads the wrong thing, so the
 * assertions that matter most in this suite are the ones that go behind it.
 * Returns rows as arrays of column strings.
 */
export function sql(query) {
  const out = execFileSync('psql', ['-h', '127.0.0.1', '-U', 'mendix', '-d', 'timeregistration', '-tAF', '', '-c', query],
    { env: { ...process.env, PGPASSWORD: 'mendix' }, encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map(line => line.split(''));
}

export function sqlValue(query) {
  const rows = sql(query);
  return rows.length ? rows[0][0] : null;
}

/** psql prints booleans as t/f, which is easy to compare against by accident. */
export function sqlBool(query) {
  return sqlValue(query) === 't';
}

/** A browser page, with the session cleared so the trial licence's seat cap does not bite. */
export async function withBrowser(fn) {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  try {
    return await fn(page, errors);
  } finally {
    await browser.close();
  }
}

/**
 * Signs in, releasing the previous session first.
 *
 * The trial licence caps concurrent sessions (finding 35), and a suite that
 * signs in a dozen times will blow through it: sign-in then quietly fails and
 * every later assertion reports a 401 as though the app were broken. Clearing
 * cookies is not enough — that orphans the session server-side rather than
 * ending it, and the orphan still counts. There is no /logout endpoint either;
 * it answers 404. So the rows go.
 */
export function clearSessions() {
  try {
    sql('delete from "system$session_user"; delete from "system$session";');
  } catch { /* first run, before the tables exist */ }
}

export async function signIn(page, user) {
  await page.context().clearCookies();
  clearSessions();
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#usernameInput', '');
  await page.fill('#usernameInput', user);
  await page.fill('#passwordInput', PASSWORD);
  await sleep(300);
  await page.click('#loginButton');
  await page.waitForLoadState('networkidle');
  await sleep(2500);
}

export async function open(page, path, wait = 2400) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await sleep(wait);
}

export async function menuItems(page) {
  return page.$$eval('.mx-navigationtree a', els => els.map(e => e.textContent.trim()));
}

export async function bodyText(page) {
  return (await page.textContent('body')).replace(/\s+/g, ' ');
}

/** Grid rows on the week screen carry a row-total cell; the audit trail's rows do not. */
export async function gridRows(page) {
  return (await page.$$('.vdh-trow .vdh-w-80')).length;
}

export async function text(page, selector, fallback = '') {
  try { return (await page.textContent(selector)).trim(); } catch { return fallback; }
}

export function beginSpec(name) {
  current = { name, results: [] };
  return current;
}

export function specResults() {
  return current;
}

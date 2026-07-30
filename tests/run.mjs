#!/usr/bin/env node
/**
 * Runs the specs in tests/specs, in filename order, against a running app.
 *
 * The specs mutate data — they submit weeks, approve them, copy rows, open new
 * months — so they assume a freshly seeded database and run in a fixed order.
 * `tests/reset.sh` puts the app back into that state; the first spec refuses to
 * continue if it is not, rather than reporting failures that are really just
 * leftovers from a previous run.
 *
 *   node tests/run.mjs              # everything
 *   node tests/run.mjs week period  # only specs whose name matches
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginSpec, specResults, BASE } from './lib/harness.mjs';

// Node block-buffers stdout when it is redirected to a file, which makes a long
// run look like a hang. Flush every line.
const say = s => { process.stdout.write(s + '\n'); };

const here = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);

const specs = readdirSync(join(here, 'specs'))
  .filter(f => f.endsWith('.spec.mjs'))
  .filter(f => filters.length === 0 || filters.some(x => f.includes(x)))
  .sort();

// Fail fast and clearly if the app is not up, rather than 40 timeouts.
const reachable = await fetch(BASE + '/login.html').then(r => r.ok).catch(() => false);
if (!reachable) {
  process.stderr.write(`\n  The app is not answering at ${BASE}.\n`);
  process.stderr.write('  cd TimeRegistration && ./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch\n');
  process.exit(2);
}

say(`\n  ${specs.length} spec file(s) against ${BASE}\n`);

let passed = 0, failed = 0, aborted = false;
const summary = [];

for (const file of specs) {
  const mod = await import(pathToFileURL(join(here, 'specs', file)).href);
  const spec = beginSpec(mod.name || file);
  process.stdout.write(`  ${spec.name}\n`);

  try {
    await mod.run();
  } catch (err) {
    spec.results.push({ label: 'spec threw', ok: false, detail: String(err).split('\n')[0] });
  }

  for (const r of specResults().results) {
    if (r.ok) { passed++; say(`    ✓ ${r.label}`); }
    else { failed++; say(`    ✗ ${r.label}${r.detail ? ` — ${r.detail}` : ''}`); }
  }
  summary.push({ name: spec.name, results: specResults().results });
  say('');

  if (mod.abortOnFailure && specResults().results.some(r => !r.ok)) {
    process.stderr.write('  This spec is a precondition for the rest; stopping.\n');
    aborted = true;
    break;
  }
}

const failedSpecs = summary.filter(s => s.results.some(r => !r.ok)).map(s => s.name);
say(`  ${passed} passed, ${failed} failed${aborted ? ', run aborted' : ''}`);
if (failedSpecs.length) say(`  failing: ${failedSpecs.join(', ')}`);
say('');
process.exit(failed > 0 ? 1 : 0);

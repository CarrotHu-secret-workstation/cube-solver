/** Run every non-browser test suite and print a compact summary. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  ['cubie model', 'cubie.test.mjs'],
  ['coordinates', 'coordinates.test.mjs'],
  ['ui mapping', 'ui-mapping.test.mjs'],
  ['orbit camera', 'orbit.test.mjs'],
  ['view sync', 'viewsync.test.mjs'],
  ['view render', 'viewrender.test.mjs'],
  ['interaction', 'interaction.test.mjs'],
  ['solver e2e', 'verify-all.mjs'],
];

let failed = 0;
for (const [name, file] of suites) {
  const r = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const last = out.trim().split('\n').filter(Boolean).pop() || '(no output)';
  const okFlag = r.status === 0;
  if (!okFlag) failed++;
  console.log((okFlag ? 'PASS' : 'FAIL') + '  ' + name.padEnd(14) + ' ' + last.slice(0, 110));
}
console.log(failed === 0 ? '\nALL SUITES PASSED' : '\n' + failed + ' SUITE(S) FAILED');
process.exit(failed === 0 ? 0 : 1);

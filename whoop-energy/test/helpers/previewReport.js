/**
 * Write the fixture HTML report to a file so it can be opened (or screenshotted)
 * while working on the layout. Not part of the test suite: `node --test` picks
 * up every `.js` file under `test/`, so the work is guarded by
 * `NODE_TEST_CONTEXT` and this file is a no-op during a test run.
 *
 * Usage: `node test/helpers/previewReport.js [outFile]`
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { renderHtmlReport } from '../../src/report/html.js';
import { makeEnergyDay, makeInsights, makeNights } from './reportFixtures.js';

const DEFAULT_OUT =
  '/tmp/claude-0/-home-user-rewyse-ai/2a1f72a4-29eb-53a3-8dd9-17000fd2ccf5/scratchpad/report-preview.html';

if (!process.env.NODE_TEST_CONTEXT) {
  const out = resolve(process.argv[2] || DEFAULT_OUT);
  const html = renderHtmlReport({
    energyDay: makeEnergyDay(),
    insights: makeInsights(),
    nights: makeNights(),
    generatedAt: '2025-09-13T12:20:00.000Z',
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
  process.stdout.write(`${out} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)\n`);
}

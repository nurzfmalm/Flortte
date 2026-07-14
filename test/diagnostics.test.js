const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', 'diagnostic-metrics.js'), 'utf8')}
globalThis.DiagnosticMetrics = DiagnosticMetrics;`;
const context = vm.createContext({});
vm.runInContext(source, context);

const repeat = (pattern, times) => Array.from({ length: times }, () => pattern).flat();
const openSamples = Array.from({ length: 5 }, (_, finger) =>
  Array.from({ length: 30 }, (_, sample) => 3600 + ((sample + finger) % 5) - 2)
);
const target = repeat([3600, 3400, 500, 100, 500, 3400], 5);
const quiet = Array.from({ length: target.length }, (_, sample) => 3600 + (sample % 3) - 1);

const passing = context.DiagnosticMetrics.analyzeFinger({
  openSamples,
  captureSamples: [target, quiet, quiet, quiet, quiet],
  fingerIndex: 0,
  thresholds: { bend: 600, release: 900 },
});
assert.strictEqual(passing.status, 'pass');
assert.strictEqual(passing.metrics.bends, 5);
assert.ok(passing.checks.every(check => check.passed));

const stuck = context.DiagnosticMetrics.analyzeFinger({
  openSamples,
  captureSamples: [Array(30).fill(4095), quiet, quiet, quiet, quiet],
  fingerIndex: 0,
  thresholds: { bend: 600, release: 900 },
});
assert.strictEqual(stuck.status, 'fail');
assert.ok(stuck.checks.some(check => check.id === 'rail' && !check.passed));
assert.ok(stuck.checks.some(check => check.id === 'range' && !check.passed));

const crosstalk = context.DiagnosticMetrics.analyzeFinger({
  openSamples,
  captureSamples: [target, target, quiet, quiet, quiet],
  fingerIndex: 0,
  thresholds: { bend: 600, release: 900 },
});
assert.strictEqual(crosstalk.status, 'warn');
assert.ok(crosstalk.checks.some(check => check.id === 'isolation' && !check.passed));

assert.strictEqual(context.DiagnosticMetrics.overall([passing, crosstalk]), 'warn');
assert.strictEqual(context.DiagnosticMetrics.overall([passing, stuck]), 'fail');

console.log('Per-finger diagnostic metrics passed.');

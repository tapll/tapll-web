import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { VERSION } from '../src/version';

it('SDK version equals package.json and is 0.4.0', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(VERSION).toBe(pkg.version);
  expect(VERSION).toBe('0.4.0');
});

it('the schema fixture is the contract copy (never hand-edited)', () => {
  const s = readFileSync(new URL('./fixtures/web-batch.v1.json', import.meta.url), 'utf8');
  expect(JSON.parse(s).definitions.WebEventBatchV1.properties.contract_version.const).toBe(1);
});

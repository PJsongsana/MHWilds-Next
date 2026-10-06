import { expect, test } from 'vitest';
import { isNewer } from './update.mjs';

test('release version compare', () => {
  expect(isNewer('0.3.0', '0.2.0')).toBe(true);
  expect(isNewer('v0.10.0', '0.9.9')).toBe(true); // numeric, not string compare
  expect(isNewer('1.0.0', '0.99.0')).toBe(true);
  expect(isNewer('0.2.0', '0.2.0')).toBe(false);
  expect(isNewer('0.1.9', '0.2.0')).toBe(false);
  expect(isNewer('', '0.2.0')).toBe(false);
  expect(isNewer('latest', '0.2.0')).toBe(false);
});

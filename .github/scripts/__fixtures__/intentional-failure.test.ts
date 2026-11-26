/**
 * CI CANARY FIXTURE: DO NOT FIX THIS TEST. The app checks job's CI self-test
 * expects it to fail, proving vitest's exit code and extract-failures.sh still
 * report a failing test.
 */

import { expect, test } from "vitest";

test("intentional failure — CI canary", () => {
  expect(1).toBe(2);
});

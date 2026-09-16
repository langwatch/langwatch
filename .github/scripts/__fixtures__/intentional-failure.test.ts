/**
 * CI CANARY FIXTURE — DO NOT FIX THIS TEST. It proves the CI failure-detection
 * pipeline (vitest exit code + extract-failures.sh) works: ci-self-test
 * captures this failure and asserts detection succeeded. If it passes, ci-self-test breaks.
 */

import { expect, test } from "vitest";

test("intentional failure — CI canary", () => {
  expect(1).toBe(2);
});

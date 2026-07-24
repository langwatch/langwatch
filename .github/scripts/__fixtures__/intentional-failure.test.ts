/**
 * CI CANARY FIXTURE — DO NOT FIX THIS TEST.
 *
 * This test is deliberately failing. It exists to prove that the CI
 * failure-detection pipeline (vitest exit code + extract-failures.sh) works.
 * The ci-self-test job runs this file, captures the failure, and asserts
 * that detection succeeded. If you make this test pass, ci-self-test breaks.
 *
 * This file lives outside langwatch/ and is excluded from normal test runs.
 */

import { expect, test } from "vitest";

test("intentional failure — CI canary", () => {
  expect(1).toBe(2);
});

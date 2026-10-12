/**
 * The scenario child must not hold a credential that reaches another tenant.
 *
 * On SaaS LANGWATCH_NLP_LAMBDA_CONFIG is a static AWS key that may invoke ANY
 * project's engine and create new ones, so it is the tenant boundary rather
 * than a configuration detail. `buildChildProcessEnv` is an allowlist and is
 * the only route from the operator's environment into the child, which makes
 * this assertion the whole check: a future forward would have to pass through
 * here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChildProcessEnv } from "../child-environment";

/**
 * Values on the parent that a forward would pick up. Set for real rather than
 * asserted against an absent variable, so the test fails if the allowlist
 * grows an entry for one of them rather than passing because nothing was set.
 */
const TENANT_WIDE_PARENT_ENV = {
  LANGWATCH_NLP_LAMBDA_CONFIG: '{"AWS_ACCESS_KEY_ID":"AKIAPARENT"}',
  AWS_ACCESS_KEY_ID: "AKIAPARENT",
  AWS_SECRET_ACCESS_KEY: "parent-secret",
  AWS_SESSION_TOKEN: "parent-token",
  AWS_REGION: "eu-central-1",
  DATABASE_URL: "postgres://parent/db",
};

beforeEach(() => {
  for (const [key, value] of Object.entries(TENANT_WIDE_PARENT_ENV)) {
    vi.stubEnv(key, value);
  }
});

// The unit config runs with `isolate: false`, and these are the variables that
// select the per-project Lambda lane, so a stub left in place would move every
// later file in this worker onto it.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the environment a scenario child is started with", () => {
  /** @scenario "The child's environment carries no AWS or per-project engine credential" */
  it("carries no AWS credential and no per-project engine configuration", () => {
    const childEnv = buildChildProcessEnv({
      LANGWATCH_API_KEY: "project-key",
      LANGWATCH_ENDPOINT: "https://app.langwatch.ai",
    });

    for (const key of Object.keys(TENANT_WIDE_PARENT_ENV)) {
      expect(childEnv[key]).toBeUndefined();
    }
  });

  it("names nothing that looks like an AWS or Lambda credential at all", () => {
    const childEnv = buildChildProcessEnv({
      LANGWATCH_API_KEY: "project-key",
      LANGWATCH_ENDPOINT: "https://app.langwatch.ai",
    });

    expect(
      Object.keys(childEnv).filter((key) => /^AWS_|LAMBDA/i.test(key)),
    ).toEqual([]);
  });
});

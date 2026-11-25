/**
 * @vitest-environment node
 * @see specs/server/feature-configuration.feature
 */
import { describe, expect, it } from "vitest";

import { GROUP_QUEUE_CONFIG } from "../groupQueue.ts";
import { resolveGroupQueuePolicyFromEnv } from "../policy-env.ts";

describe("the group queue's concurrency with GLOBAL_QUEUE_CONCURRENCY unset", () => {
  /** @scenario "A feature's defaults are the values a deployment already runs on" */
  it("runs the previous release's 100 jobs at once", () => {
    expect(resolveGroupQueuePolicyFromEnv({}).globalConcurrency).toBeUndefined();
    expect(GROUP_QUEUE_CONFIG.defaultGlobalConcurrency).toBe(100);
  });

  it("takes the operator's value when one is written", () => {
    expect(resolveGroupQueuePolicyFromEnv({ globalConcurrency: "1000" }).globalConcurrency).toBe(
      1000,
    );
  });
});

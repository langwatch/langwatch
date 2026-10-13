/**
 * @vitest-environment node
 * @see specs/background/worker-graceful-shutdown.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { GROUP_QUEUE_CONFIG } from "../groupQueue.ts";

describe("the group queue's drain budget with no override", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe.each(["production", "development", "test"])("when NODE_ENV is %s", (environment) => {
    /** @scenario "The drain budget defaults to 25s everywhere" */
    it("is the one 25 second default, read from no environment", () => {
      vi.stubEnv("NODE_ENV", environment);

      expect(GROUP_QUEUE_CONFIG.shutdownTimeoutMs).toBe(25_000);
    });
  });
});

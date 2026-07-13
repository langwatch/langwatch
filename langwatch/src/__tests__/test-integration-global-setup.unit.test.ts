import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setup } from "../server/event-sourcing/__tests__/integration/globalSetup";

describe("Feature: Test shard hard-floor failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CI", "true");
    vi.stubEnv("CI_CLICKHOUSE_URL", "http://localhost:8123");
    vi.stubEnv("CI_REDIS_URL", "redis://localhost:6379");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("when the hard-floor timeout expires", () => {
    it("keeps the test process running before twenty minutes", async () => {
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as typeof process.exit);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);

      await setup();
      vi.advanceTimersByTime(20 * 60 * 1000 - 1);

      expect(exit).not.toHaveBeenCalled();
    });

    /** @scenario An integration test shard hard floor exits with failure after twenty minutes */
    it("exits the test process with a failure status at twenty minutes", async () => {
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as typeof process.exit);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "log").mockImplementation(() => undefined);

      await setup();
      vi.advanceTimersByTime(20 * 60 * 1000);

      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setup } from "../test-unit-global-setup";

describe("Feature: Test shard hard-floor failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("CI", "true");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("when the hard-floor timeout expires", () => {
    it("keeps the test process running before four minutes", async () => {
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as typeof process.exit);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await setup();
      vi.advanceTimersByTime(4 * 60 * 1000 - 1);

      expect(exit).not.toHaveBeenCalled();
    });

    /** @scenario A unit test shard hard floor exits with failure after four minutes */
    it("exits the test process with a failure status at four minutes", async () => {
      const exit = vi
        .spyOn(process, "exit")
        .mockImplementation((() => undefined) as typeof process.exit);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await setup();
      vi.advanceTimersByTime(4 * 60 * 1000);

      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});

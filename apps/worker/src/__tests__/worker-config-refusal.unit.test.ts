import { afterEach, describe, expect, it, vi } from "vitest";

import { startWorker } from "../main.ts";

describe("the worker process boot", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("given an environment carrying an unreadable value", () => {
    /** @scenario "The worker validates its configuration before it connects or consumes" */
    it("refuses with the configuration parse, naming the variable, before anything connects or consumes", async () => {
      vi.stubEnv("WORKER_METRICS_PORT", "not-a-port");

      const failure = await startWorker({ ownsProcess: false, ownsTelemetry: false }).then(
        () => void 0,
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ code: "config_refused" });
      expect(failure).toHaveProperty(
        "refusals",
        expect.arrayContaining([expect.stringContaining("WORKER_METRICS_PORT")]),
      );
    });
  });
});

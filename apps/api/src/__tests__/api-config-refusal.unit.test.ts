import { afterEach, describe, expect, it, vi } from "vitest";

import { startApi } from "../main.ts";

describe("the api process boot", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("given an environment carrying an unreadable value", () => {
    /** @scenario "The API validates its configuration before it composes or listens" */
    it("refuses with the configuration parse, naming the variable, before anything composes", async () => {
      vi.stubEnv("API_PORT", "not-a-port");

      const failure = await startApi({ ownsProcess: false, ownsTelemetry: false }).then(
        () => void 0,
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({ code: "config_refused" });
      expect(failure).toHaveProperty(
        "refusals",
        expect.arrayContaining([expect.stringContaining("API_PORT")]),
      );
    });
  });
});

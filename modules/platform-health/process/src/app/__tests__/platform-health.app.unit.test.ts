import { ScopedSecrets, type SecretHandle } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { PlatformHealthApp } from "../platform-health.app.ts";

const values: Record<string, string> = { PLATFORM_HEALTH_API_KEY: "monitoring-key" };

const secrets = new ScopedSecrets(async (handle: SecretHandle<unknown>, build) =>
  build(values[handle.id]),
);

describe("given the monitoring key is declared as a secret handle", () => {
  describe("when the app is created", () => {
    it("reads the key through the handle and accepts it", async () => {
      const app = await PlatformHealthApp.create({
        dependencies: {},
        members: { publicBaseUrl: undefined },
        secrets,
      } as never);

      expect(app.acceptsKey("monitoring-key")).toBe(true);
      expect(app.acceptsKey("other")).toBe(false);
    });
  });
});

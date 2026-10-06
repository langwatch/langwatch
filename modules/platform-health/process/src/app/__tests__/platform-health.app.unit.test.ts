import { ScopedSecrets, type SecretHandle } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { PlatformHealthModule } from "../platform-health.app.ts";

const values: Record<string, string> = { PLATFORM_HEALTH_API_KEY: "monitoring-key" };

const secrets = new ScopedSecrets(async (handle: SecretHandle<unknown>, build) =>
  build(values[handle.id]),
);

const presenting = (key: string) =>
  new Request("http://localhost/api/v1/platform-health", {
    headers: { authorization: `Bearer ${key}` },
  });

describe("given the monitoring key is declared as a secret handle", () => {
  describe("when the app is created", () => {
    it("reads the key through the handle into the family's door", async () => {
      const app = await PlatformHealthModule.create({
        dependencies: {},
        config: { publicBaseUrl: undefined },
        secrets,
      } as never);

      expect(app.monitorDoor.identify?.({ request: presenting("monitoring-key") })).toEqual({
        actor: null,
        scope: null,
        internal: { type: "internalSecret", secretName: "platform-health" },
      });
      expect(() => app.monitorDoor.identify?.({ request: presenting("other") })).toThrow(
        expect.objectContaining({ code: "unauthorized" }),
      );
    });
  });
});

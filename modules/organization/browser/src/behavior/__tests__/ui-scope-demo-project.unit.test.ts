/** The one deployment fact the scope rules need from the HTML shell. */

import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import { describe, expect, it } from "vitest";

import { readUiDemoProjectSlug } from "../ui-scope-capability";

describe("given the deployment's demo project slug", () => {
  describe("when the HTML shell declares one", () => {
    it("reads it out of the shell", () => {
      const meta = createPublicAppConfigMetaTag({
        appBaseUrl: "https://app.example.com",
        gatewayBaseUrl: "https://gateway.example.com",
        deployment: "saas",
        demoProjectSlug: "demo-project",
        mode: "test",
        telemetry: { browserTracing: false, sampleRatio: 0 },
        capabilities: { email: false, nlp: false, langevals: false },
        passkeys: false,
        identityFrontDoor: false,
      });
      const documentRoot = {
        querySelector: () => ({
          getAttribute: () => /content="([^"]+)"/.exec(meta)?.[1] ?? null,
        }),
      };

      expect(readUiDemoProjectSlug(documentRoot)).toBe("demo-project");
    });
  });

  describe("when the shell declares none", () => {
    it("reads no demo project rather than failing the whole session", () => {
      expect(readUiDemoProjectSlug({ querySelector: () => null })).toBeUndefined();
    });
  });
});

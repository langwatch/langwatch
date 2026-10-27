import { describe, expect, it } from "vitest";

import { parseProcessConfig } from "../config.ts";
import { otelResourceAttributes, releaseVersionOf, serviceVersion } from "../deployment-facts.ts";

const ops = { name: "ops", config: { serviceVersion, otelResourceAttributes } } as const;
const versionOf = (environment: Record<string, string | undefined>) =>
  releaseVersionOf(parseProcessConfig({ owners: [ops], environment }).ops);

describe("given an owner holding the release leaves", () => {
  describe("when the deployment names a release", () => {
    /** @scenario "The release version is the one the deployment named" */
    it("reads SERVICE_VERSION first, then service.version in the resource attributes", () => {
      expect(versionOf({ SERVICE_VERSION: " 3.17.0 " })).toBe("3.17.0");
      expect(
        versionOf({
          SERVICE_VERSION: "3.17.0",
          OTEL_RESOURCE_ATTRIBUTES: "service.version=4.0",
        }),
      ).toBe("3.17.0");
      expect(
        versionOf({ OTEL_RESOURCE_ATTRIBUTES: "service.name=langwatch,service.version=4.0" }),
      ).toBe("4.0");
      expect(versionOf({ OTEL_RESOURCE_ATTRIBUTES: " service.version = 4.0%2Brc1 " })).toBe(
        "4.0+rc1",
      );
      expect(versionOf({ OTEL_RESOURCE_ATTRIBUTES: "service.version=4%ZZ" })).toBe("4%ZZ");
      expect(
        versionOf({ OTEL_RESOURCE_ATTRIBUTES: "service.version=4.0,service.version=4.1" }),
      ).toBe("4.1");
    });
  });

  describe("when the deployment names none", () => {
    /** @scenario "A deployment that names no release reports unknown" */
    it("reports unknown rather than a number made up here", () => {
      expect(versionOf({})).toBe("unknown");
      expect(versionOf({ SERVICE_VERSION: "", OTEL_RESOURCE_ATTRIBUTES: "" })).toBe("unknown");
      expect(versionOf({ SERVICE_VERSION: "   " })).toBe("unknown");
      expect(versionOf({ OTEL_RESOURCE_ATTRIBUTES: "service.name=langwatch" })).toBe("unknown");
      expect(versionOf({ OTEL_RESOURCE_ATTRIBUTES: "service.version=" })).toBe("unknown");
    });
  });
});

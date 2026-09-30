import { describe, expect, it } from "vitest";
import { readInstallVersion } from "../installVersion";

describe("given the version this install reports", () => {
  describe("when the deployment names one", () => {
    it("reports what the deployment named", () => {
      expect(readInstallVersion({ SERVICE_VERSION: "3.17.0" })).toBe("3.17.0");
      expect(
        readInstallVersion({
          OTEL_RESOURCE_ATTRIBUTES:
            "service.name=langwatch,service.version=4.0",
        }),
      ).toBe("4.0");
    });
  });

  describe("when the deployment names none", () => {
    it("reports unknown rather than a number made up here", () => {
      expect(readInstallVersion({})).toBe("unknown");
    });
  });
});

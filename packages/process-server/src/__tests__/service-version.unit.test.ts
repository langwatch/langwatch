// @vitest-environment node
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { observabilityOwner } from "../observability-owner.ts";
import { serviceVersionOf } from "../process-server.ts";

const versionOf = (environment: Record<string, string | undefined>) =>
  serviceVersionOf(parseProcessConfig({ owners: [observabilityOwner], environment }).observability);

describe("given the version this install reports", () => {
  describe("when the deployment names one", () => {
    it("reports what the deployment named", () => {
      expect(versionOf({ SERVICE_VERSION: "3.17.0" })).toBe("3.17.0");
      expect(
        versionOf({ OTEL_RESOURCE_ATTRIBUTES: "service.name=langwatch,service.version=4.0" }),
      ).toBe("4.0");
    });
  });

  describe("when the deployment names none", () => {
    it("reports unknown rather than a number made up here", () => {
      expect(versionOf({})).toBe("unknown");
    });
  });
});

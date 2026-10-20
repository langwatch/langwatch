import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { managedProviderConfig } from "../managed-provider.config.ts";

function parse(environment: Record<string, string>) {
  return parseProcessConfig({
    owners: [{ name: "managed-provider", config: managedProviderConfig }],
    environment,
  })["managed-provider"];
}

describe("managed provider STS base configuration", () => {
  describe("given MANAGED_BEDROCK_STS_BASE", () => {
    /** @scenario "An STS base that is unset or blank reaches AWS" */
    it("reads as unset when it is not exported", () => {
      expect(parse({}).stsBase).toBeUndefined();
    });

    /** @scenario "An STS base that is unset or blank reaches AWS" */
    it("reads as unset when it is exported blank", () => {
      expect(parse({ MANAGED_BEDROCK_STS_BASE: "  " }).stsBase).toBeUndefined();
    });

    /** @scenario "The role hops reach the STS base the deployment configures" */
    it("carries the configured URL", () => {
      expect(parse({ MANAGED_BEDROCK_STS_BASE: "http://127.0.0.1:5597/sts" }).stsBase).toBe(
        "http://127.0.0.1:5597/sts",
      );
    });

    it("refuses a value that is set but is not a URL", () => {
      expect(() => parse({ MANAGED_BEDROCK_STS_BASE: "not a url" })).toThrow(
        /MANAGED_BEDROCK_STS_BASE/,
      );
    });
  });
});

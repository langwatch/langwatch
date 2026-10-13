import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { notificationConfig } from "../notification.config.ts";

function parse(environment: Record<string, string>) {
  return parseProcessConfig({
    owners: [{ name: "notification", config: notificationConfig }],
    environment,
  }).notification;
}

describe("notification push service base configuration", () => {
  describe("given WEB_PUSH_SERVICE_BASE", () => {
    /** @scenario "Without a configured push service base only the browsers' push services are accepted" */
    it("reads as unset when it is not exported or is blank", () => {
      expect(parse({}).webPushServiceBase).toBeUndefined();
      expect(parse({ WEB_PUSH_SERVICE_BASE: " " }).webPushServiceBase).toBeUndefined();
    });

    /** @scenario "A configured push service base is accepted and reached beside the browsers' own" */
    it("carries the configured URL", () => {
      expect(
        parse({ WEB_PUSH_SERVICE_BASE: "https://127.0.0.1:5598/push" }).webPushServiceBase,
      ).toBe("https://127.0.0.1:5598/push");
    });

    it("refuses a value that is set but is not a URL", () => {
      expect(() => parse({ WEB_PUSH_SERVICE_BASE: "not a url" })).toThrow(/WEB_PUSH_SERVICE_BASE/);
    });
  });
});

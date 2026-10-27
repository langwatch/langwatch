import { describe, expect, it } from "vitest";

import { isKnownPushServiceEndpoint } from "../web-push.rules.ts";

const BASE = "https://127.0.0.1:5598/push";

describe("isKnownPushServiceEndpoint", () => {
  describe("given no configured push service base", () => {
    /** @scenario "Without a configured push service base only the browsers' push services are accepted" */
    it("accepts a browser push service and refuses a local one", () => {
      expect(isKnownPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/1")).toBe(true);
      expect(isKnownPushServiceEndpoint("https://127.0.0.1:5598/push/laptop")).toBe(false);
    });
  });

  describe("given a configured push service base", () => {
    /** @scenario "A configured push service base is accepted and reached beside the browsers' own" */
    it("accepts an endpoint below the base and still the browsers' own", () => {
      expect(isKnownPushServiceEndpoint(`${BASE}/laptop`, { configuredBase: BASE })).toBe(true);
      expect(
        isKnownPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/1", {
          configuredBase: BASE,
        }),
      ).toBe(true);
    });

    /** @scenario "A configured push service base is accepted and reached beside the browsers' own" */
    it("refuses anything wider than the base", () => {
      for (const endpoint of [
        BASE,
        `${BASE}/`,
        "https://127.0.0.1:5598/other/laptop",
        "https://127.0.0.1:5599/push/laptop",
        "http://127.0.0.1:5598/push/laptop",
        "https://user:pw@127.0.0.1:5598/push/laptop",
      ]) {
        expect(isKnownPushServiceEndpoint(endpoint, { configuredBase: BASE })).toBe(false);
      }
    });
  });
});

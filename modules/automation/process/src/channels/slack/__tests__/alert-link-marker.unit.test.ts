/**
 * @see modules/automation/specs/alert-link-opened.feature
 */
import { ALERT_LINK_MARKER } from "@langwatch/automation-contract/alert-link";
import { withLinkMarker } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

const APP = "https://app.test";
const mark = (url: string) => withLinkMarker({ url, appBaseUrl: APP, marker: ALERT_LINK_MARKER });

describe("an alert link's marker", () => {
  describe("when the link is our own app's", () => {
    /** @scenario "An alert link carries the marker in its query, before any hash" */
    it("sets the marker in the query, keeping any query and hash", () => {
      expect(mark(`${APP}/acme/traces/t1`)).toBe(`${APP}/acme/traces/t1?lw_from=alert`);
      expect(mark(`${APP}/acme/traces/t1?t=1700000000000`)).toBe(
        `${APP}/acme/traces/t1?t=1700000000000&lw_from=alert`,
      );
      expect(mark(`${APP}/acme/traces/t1#spans`)).toBe(`${APP}/acme/traces/t1?lw_from=alert#spans`);
      expect(mark(`${APP}/acme/traces/t1?t=1#spans`)).toBe(
        `${APP}/acme/traces/t1?t=1&lw_from=alert#spans`,
      );
    });
  });

  describe("when the link is not our own app's", () => {
    /** @scenario "A link to another site, or no site, is left unchanged" */
    it("returns it unchanged", () => {
      expect(mark("https://example.com/report?x=1#top")).toBe("https://example.com/report?x=1#top");
      expect(mark("http://app.test/acme/traces/t1")).toBe("http://app.test/acme/traces/t1");
      expect(mark("/acme/traces/t1")).toBe("/acme/traces/t1");
      expect(mark("#")).toBe("#");
    });
  });
});

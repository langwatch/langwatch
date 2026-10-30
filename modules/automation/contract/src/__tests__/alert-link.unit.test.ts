/**
 * @see modules/automation/specs/alert-link-opened.feature
 */
import { describe, expect, it } from "vitest";

import {
  alertLinkLandingOf,
  alertLinkOpened,
  isAlertLinkSearch,
  searchWithoutAlertMarker,
  withAlertLinkMarker,
} from "../alert-link.ts";

describe("withAlertLinkMarker", () => {
  describe("when a link is marked", () => {
    /** @scenario "An alert link carries the marker after any query it already has" */
    it("adds the marker after any query, and leaves a dead link alone", () => {
      expect(withAlertLinkMarker("https://app.test/acme/traces/t1?t=1700000000000")).toBe(
        "https://app.test/acme/traces/t1?t=1700000000000&lw_from=alert",
      );
      expect(withAlertLinkMarker("https://app.test/acme/traces/t1")).toBe(
        "https://app.test/acme/traces/t1?lw_from=alert",
      );
      expect(withAlertLinkMarker("#")).toBe("#");
    });
  });
});

describe("reading an alert landing", () => {
  it("tells a marked query from an unmarked one and drops only the marker", () => {
    expect(isAlertLinkSearch("?t=1&lw_from=alert")).toBe(true);
    expect(isAlertLinkSearch("?t=1&lw_from=email")).toBe(false);
    expect(searchWithoutAlertMarker("?t=1&lw_from=alert")).toBe("?t=1");
    expect(searchWithoutAlertMarker("?lw_from=alert")).toBe("");
  });

  it("names the page from its path and sends no id", () => {
    expect(alertLinkLandingOf("/acme/traces/trace_1")).toBe("trace");
    expect(alertLinkLandingOf("/acme/analytics/custom/graph_1")).toBe("graph");
    expect(alertLinkLandingOf("/acme/automations")).toBe("other");
    expect(alertLinkOpened({ landedOn: "graph" })).toEqual({
      boundary: "automations",
      action: "opened",
      name: "alert_link",
      attributes: { landedOn: "graph" },
    });
  });
});

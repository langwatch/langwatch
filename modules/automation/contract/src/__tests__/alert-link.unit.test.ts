/**
 * @see modules/automation/specs/alert-link-opened.feature
 */
import { describe, expect, it } from "vitest";

import {
  alertLinkLandingOf,
  alertLinkOpened,
  isAlertLinkSearch,
  withAlertLinkMarker,
} from "../alert-link.ts";
import { renderWebhookBody } from "../templating/render-webhook-body.ts";
import { buildTemplateContext } from "../templating/template-context.ts";

const APP = "https://app.test";
const mark = (url: string) => withAlertLinkMarker({ url, appBaseUrl: APP });

describe("withAlertLinkMarker", () => {
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

describe("renderWebhookBody", () => {
  describe("when a webhook links a trace and a chart", () => {
    /** @scenario "Webhook bodies and custom templates carry no marker" */
    it("sends the links without the marker", async () => {
      const context = buildTemplateContext({
        trigger: { id: "trigger_1", name: "Errors", alertType: null },
        project: { name: "Acme", slug: "acme" },
        baseHost: APP,
        matches: [{ traceId: "trace_1" }, { graphId: "graph_1" }],
      });

      const rendered = await renderWebhookBody({ template: null, context });

      expect(context.matches.map((match) => match.trace.url)).toEqual([
        `${APP}/acme/traces/trace_1`,
        `${APP}/acme/analytics/custom/graph_1`,
      ]);
      expect(rendered.body).not.toContain("lw_from");
    });
  });
});

describe("reading an alert landing", () => {
  it("tells a marked query from an unmarked one", () => {
    expect(isAlertLinkSearch("?t=1&lw_from=alert")).toBe(true);
    expect(isAlertLinkSearch("?t=1&lw_from=email")).toBe(false);
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

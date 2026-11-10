/**
 * @see modules/automation/specs/alert-link-opened.feature
 */
import { describe, expect, it } from "vitest";

import { alertLinkLandingOf, alertLinkOpened, isAlertLinkSearch } from "../alert-link.ts";
import { renderWebhookBody } from "../templating/render-webhook-body.ts";
import { buildTemplateContext } from "../templating/template-context.ts";

const APP = "https://app.test";

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

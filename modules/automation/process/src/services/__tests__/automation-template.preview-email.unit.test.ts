import {
  AlertType,
  automationApiPreviewEmailInputSchema,
  buildExampleGraphAlertTemplateContext,
  defaultsForSourceKind,
} from "@langwatch/automation-contract";
import { renderTriggerEmail } from "@langwatch/automation-contract/templating";
import { describe, expect, it } from "vitest";

import type { AutomationTestFire } from "../../channels/automation-test-fire.channel.ts";
import { AutomationTemplateService } from "../automation-template.service.ts";

const BASE_HOST = "https://app.langwatch.ai";
const PROJECT = { name: "Acme", slug: "acme" };

function makeService() {
  const refuse = async (): Promise<never> => {
    throw new Error("a preview never delivers");
  };
  const delivery: AutomationTestFire = {
    sendEmail: refuse,
    sendSlack: refuse,
    sendSlackBot: refuse,
    sendWebhook: refuse,
  };
  return AutomationTemplateService.create({ baseHost: BASE_HOST, delivery });
}

describe("AutomationTemplateService.previewEmail", () => {
  describe("when the draft is a trace automation", () => {
    it("renders the same email renderTriggerEmail produces over the example context", async () => {
      const preview = await makeService().previewEmail({
        trigger: { name: "Slow traces", alertType: null },
        project: PROJECT,
        draft: { emailSubjectTemplate: "Hi {{ trigger.name }}", emailBodyTemplate: "# Body" },
        graphAlert: null,
        report: null,
      });

      expect(preview.subject).toBe("Hi Slow traces");
      expect(preview.html).toContain("<h1>Body</h1>");
      expect(preview.usedDefault).toBe(false);
    });
  });

  describe("when the draft is a graph alert", () => {
    it("matches renderTriggerEmail with the alert example context and defaults", async () => {
      const preview = await makeService().previewEmail({
        trigger: { name: "Latency", alertType: AlertType.WARNING },
        project: PROJECT,
        draft: {},
        graphAlert: { graphName: "p95", threshold: 3 },
        report: null,
      });

      const expected = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: buildExampleGraphAlertTemplateContext({
          baseHost: BASE_HOST,
          project: PROJECT,
          trigger: { name: "Latency", alertType: AlertType.WARNING },
          graph: { name: "p95" },
          condition: { threshold: 3 },
        }),
        defaults: defaultsForSourceKind("graphAlert"),
      });

      expect(preview).toEqual(expected);
    });
  });

  describe("when the draft is a report on its own schedule", () => {
    it("names that schedule in the subject and body, through the wire schema", async () => {
      const { report, trigger, draft } = automationApiPreviewEmailInputSchema.parse({
        projectId: "project-1",
        trigger: { name: "Quarter hour", alertType: null },
        draft: {},
        report: { sourceKind: "traceQuery", scheduleLabel: "*/15 * * * * (Europe/Amsterdam)" },
      });

      const preview = await makeService().previewEmail({
        trigger,
        project: PROJECT,
        draft,
        graphAlert: null,
        report,
      });

      expect(preview.subject).toContain("*/15 * * * * (Europe/Amsterdam)");
      expect(preview.html).toContain("*/15 * * * * (Europe/Amsterdam)");
      expect(preview.subject).not.toContain("every Monday");
    });
  });
});

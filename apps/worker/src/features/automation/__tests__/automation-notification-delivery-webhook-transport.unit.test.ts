import { AutomationNotificationDeliveryAdapter } from "@langwatch/automation-server";
import { DispatchError } from "@langwatch/eventing";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { EmailDelivery, type EmailContent } from "@langwatch/notification-server";
import { describe, expect, it } from "vitest";

import { createWorkerWebhookTransport } from "../../../app/worker-webhook-egress.composition.ts";
import { resolveWorkerConfig } from "../../../platform/config/worker.config.ts";

/**
 * The one seam that stays worker-owned: the adapter itself moved to
 * `@langwatch/automation-server`, but the SSRF-fenced transport it dispatches
 * through is composed from this process's own config.
 */
const BASE_HOST = "https://app.langwatch.test";

class RecordingMailer extends EmailDelivery {
  readonly sent: EmailContent[] = [];

  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }

  async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return {};
  }
}

describe("AutomationNotificationDeliveryAdapter", () => {
  describe("given a composed alert delivery adapter with this process's own webhook transport", () => {
    /**
     * Spec: packages/egress/specs/webhook-egress.feature
     *
     * The named absence closing, observed at the port the graph actually calls:
     * the refusal a webhook alert meets is now the fence's judgement of the
     * ADDRESS, not the adapter's report that this process owns no sender.
     */
    /** @scenario "The delivery port stops refusing webhook automations by name" */
    it("dispatches into the packaged fence instead of refusing for want of a sender", async () => {
      const adapter = AutomationNotificationDeliveryAdapter.create({
        mailer: new RecordingMailer(),
        renderer: ReactEmailMailRenderer.create(),
        baseHost: BASE_HOST,
        webhookTransport: createWorkerWebhookTransport({
          config: resolveWorkerConfig({
            BASE_HOST,
            EMAIL_DEFAULT_FROM: "LangWatch <contact@langwatch.ai>",
          }),
        }),
      });

      const error = (await adapter
        .sendWebhook({
          projectId: "project-1",
          triggerId: "trigger-1",
          eventId: "evt_1",
          url: "https://10.0.0.5/hook",
          body: "{}",
          triggerName: "Error rate",
        })
        .catch((err: unknown) => err)) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/private or loopback/i);
      expect(error.message).not.toMatch(/no outbound webhook sender/);
    });
  });
});

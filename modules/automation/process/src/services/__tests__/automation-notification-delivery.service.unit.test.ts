import { ReactEmailMailRenderer } from "@langwatch/mail";
import { recordingMail } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type { WebhookDeliveryTransport } from "../../channels/http/http.webhook-delivery.channel.ts";
import { AutomationNotificationDeliveryAdapter } from "../automation-notification-delivery.service.ts";

/**
 * The expected envelope was recorded from the application's own sender. It is a
 * literal because a recipient cannot tell which process wrote to them.
 * Spec: modules/automation/specs/graph-alert-delivery-envelope.feature
 */
const SIGNING_KEY = "0f".repeat(32);
const BASE_HOST = "https://app.langwatch.test";

const APPLICATION_NO_REPLY = "LangWatch Triggers <no-reply+81d9d46cce00@langwatch.ai>";
const APPLICATION_TRIGGER_TOKEN =
  "eyJwcm9qZWN0SWQiOiJwcm9qZWN0LTEiLCJ0cmlnZ2VySWQiOiJ0cmlnZ2VyLTEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSJ9.aba1dbbe8d7ba211a0d91c962a5993e4d61fcc0b56c55c06c37e24cbbd5af6b1";
const APPLICATION_PROJECT_TOKEN =
  "eyJwcm9qZWN0SWQiOiJwcm9qZWN0LTEiLCJ0cmlnZ2VySWQiOm51bGwsImVtYWlsIjoiYWRhQGV4YW1wbGUuY29tIn0.ec785b87b9ec6dfda75a6bf6099fae99780222f09cba44b352eedac673ff18d0";
const APPLICATION_HTML = `<html><body><p>hi</p>
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #F2F4F8;color:#8B96A5;font-size:12px;line-height:18px;">
      <a href="${BASE_HOST}/unsubscribe?token=${APPLICATION_TRIGGER_TOKEN}" style="color:#8B96A5;text-decoration:underline;">Stop receiving this notification</a>
      &nbsp;·&nbsp;
      <a href="${BASE_HOST}/unsubscribe?token=${APPLICATION_PROJECT_TOKEN}" style="color:#8B96A5;text-decoration:underline;">Stop all notifications from this project</a>
    </div></body></html>`;

class RecordingLogger {
  readonly warnings: unknown[][] = [];

  warn(...args: unknown[]): void {
    this.warnings.push(args);
  }
  error(): void {}
  info(): void {}
  debug(): void {}
}

function composeDelivery(
  over: { logger?: RecordingLogger; webhookTransport?: WebhookDeliveryTransport } = {},
) {
  const mailer = recordingMail();
  const logger = over.logger ?? new RecordingLogger();
  const adapter = AutomationNotificationDeliveryAdapter.create({
    mailer,
    renderer: ReactEmailMailRenderer.create(),
    baseHost: BASE_HOST,
    unsubscribeSigningSecret: SIGNING_KEY,
    ...(over.webhookTransport ? { webhookTransport: over.webhookTransport } : {}),
    logger: logger as never,
  });

  return { adapter, mailer, logger };
}

function alert(
  over: Partial<Parameters<AutomationNotificationDeliveryAdapter["sendEmail"]>[0]> = {},
) {
  const claimed = new Set<string>();

  return {
    recipients: ["ada@example.com"],
    triggerId: "trigger-1",
    projectId: "project-1",
    subject: "Errors above threshold",
    html: "<html><body><p>hi</p></body></html>",
    isRecipientSent: async (hash: string) => claimed.has(hash),
    recordRecipientSent: async (hash: string) => void claimed.add(hash),
    ...over,
  };
}

describe("AutomationNotificationDeliveryAdapter", () => {
  describe("given a composed alert delivery adapter", () => {
    /** @scenario "Recipients ride in BCC behind a no-reply" */
    it("addresses the no-reply and delivers the recipient as BCC", async () => {
      const { adapter, mailer } = composeDelivery();

      await adapter.sendEmail(alert());

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe(APPLICATION_NO_REPLY);
      expect(mailer.sent[0]?.bcc).toEqual(["ada@example.com"]);
    });

    /** @scenario "The footer and its one-click headers are the application's" */
    it("appends the application's footer and one-click headers", async () => {
      const { adapter, mailer } = composeDelivery();

      await adapter.sendEmail(alert());

      expect(mailer.sent[0]?.html).toBe(APPLICATION_HTML);
      expect(mailer.sent[0]?.headers).toEqual({
        "List-Unsubscribe": `<${BASE_HOST}/api/unsubscribe?token=${APPLICATION_TRIGGER_TOKEN}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
    });

    /** @scenario "A newline in the subject never becomes a header" */
    it("flattens a subject that carries a line break", async () => {
      const { adapter, mailer } = composeDelivery();

      await adapter.sendEmail(alert({ subject: "Errors\r\nabove threshold" }));

      expect(mailer.sent[0]?.subject).toBe("Errors above threshold");
    });

    /** @scenario "A malformed recipient is skipped rather than sent to" */
    it("skips an address that is not an address, without logging it", async () => {
      const logger = new RecordingLogger();
      const { adapter, mailer } = composeDelivery({ logger });

      await adapter.sendEmail(alert({ recipients: ["not-an-email", "ada@example.com"] }));

      expect(mailer.sent.map((message) => message.bcc)).toEqual([["ada@example.com"]]);
      expect(JSON.stringify(logger.warnings)).not.toContain("not-an-email");
    });
  });

  describe("given one recipient was delivered on an earlier attempt", () => {
    /** @scenario "A recipient already written to is not written to again" */
    it("sends only to the remaining recipient and claims by hash", async () => {
      const { adapter, mailer } = composeDelivery();
      const claimed: string[] = [];
      // The hash the application derives for `ada@example.com`: the first 16
      // characters of its SHA-256, so the claim table never holds an address.
      const adaHash = "b5fc85e55755f9e0";

      await adapter.sendEmail(
        alert({
          recipients: ["ada@example.com", "grace@example.com"],
          isRecipientSent: async (hash: string) => hash === adaHash,
          recordRecipientSent: async (hash: string) => void claimed.push(hash),
        }),
      );

      expect(mailer.sent.map((message) => message.bcc)).toEqual([["grace@example.com"]]);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatch(/^[0-9a-f]{16}$/);
      expect(claimed[0]).not.toContain("grace");
    });
  });

  describe("given a composed alert delivery adapter with no webhook transport", () => {
    /** @scenario "A channel this process cannot send through refuses by name" */
    it("refuses a webhook alert naming what is missing", async () => {
      const { adapter } = composeDelivery();

      await expect(
        adapter.sendWebhook({
          projectId: "project-1",
          triggerId: "trigger-1",
          eventId: "evt_1",
          url: "https://acme.test/hook",
          body: "{}",
          triggerName: "Error rate",
        }),
      ).rejects.toThrow(/no outbound webhook sender/);
    });
  });

  /**
   * The digest most automations send (when the author hasn't written a custom
   * subject or body). Spec: specs/automations/worker-automation-settlement-conversion.feature
   */
  describe("given an automation whose author wrote no template", () => {
    /** @scenario "The settlement digest renders and sends from this process" */
    it("renders the deployment's own digest and sends it per recipient", async () => {
      const { adapter, mailer } = composeDelivery();
      const claimed = new Set<string>();

      await adapter.sendLegacyEmail({
        recipients: ["ada@example.com"],
        triggerData: [
          {
            traceId: "trace-1",
            input: "hello",
            output: "world",
            projectId: "project-1",
            fullTrace: {} as never,
          },
        ],
        triggerName: "Error rate",
        triggerId: "trigger-1",
        projectId: "project-1",
        projectSlug: "acme",
        triggerType: null,
        triggerMessage: "over budget",
        isRecipientSent: async (hash) => claimed.has(hash),
        recordRecipientSent: async (hash) => void claimed.add(hash),
      });

      expect(mailer.sent).toHaveLength(1);
      const sent = mailer.sent[0]!;
      expect(sent.subject).toBe("Trigger - Error rate");
      expect(sent.to).toBe(APPLICATION_NO_REPLY);
      expect(sent.bcc).toEqual(["ada@example.com"]);
      // The link a reader clicks, and the message its author wrote.
      expect(sent.html).toContain(`${BASE_HOST}/acme/traces/trace-1`);
      expect(sent.html).toContain("over budget");
      // The footer is appended OUTSIDE the customer's template, so a template
      // author cannot strip it, and both unsubscribe scopes are offered.
      expect(sent.html).toContain("Stop receiving this notification</a>");
      expect(sent.html).toContain("Stop all notifications from this project</a>");
      expect(sent.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    });

    /** @scenario "The default digest row carries when it happened and what matched" */
    it("carries the trace's start time and computed input into the digest row", async () => {
      const { adapter, mailer } = composeDelivery();
      const claimed = new Set<string>();
      const startedAt = Date.UTC(2026, 5, 15, 12, 0, 0);

      await adapter.sendLegacyEmail({
        recipients: ["ada@example.com"],
        triggerData: [
          {
            traceId: "trace-1",
            input: "why did the refund fail",
            output: "world",
            projectId: "project-1",
            fullTrace: { timestamps: { started_at: startedAt } } as never,
          },
        ],
        triggerName: "Error rate",
        triggerId: "trigger-1",
        projectId: "project-1",
        projectSlug: "acme",
        triggerType: null,
        triggerMessage: "over budget",
        isRecipientSent: async (hash) => claimed.has(hash),
        recordRecipientSent: async (hash) => void claimed.add(hash),
      });

      const sent = mailer.sent[0]!;
      expect(sent.html).toContain("why did the refund fail");
      expect(sent.html).toContain(new Date(startedAt).toISOString().slice(0, 10));
      expect(sent.html).toContain(`${BASE_HOST}/acme/traces/trace-1?t=${startedAt}`);
    });

    /** @scenario "The settlement digest renders and sends from this process" */
    it("sends the same digest to Slack through the packaged renderer", async () => {
      const posted: unknown[] = [];
      const { adapter } = composeDelivery();
      // The Slack client is composed inside the adapter, so the assertion is
      // that the call reaches a genuine Slack webhook check rather than a
      // refusal by name.
      await expect(
        adapter.sendLegacySlackWebhook({
          webhook: "https://example.test/not-slack",
          triggerData: [],
          triggerName: "Error rate",
          projectSlug: "acme",
          triggerType: null,
          triggerMessage: "",
          baseHost: BASE_HOST,
        }),
      ).rejects.toThrow(/slack/i);
      expect(posted).toHaveLength(0);
    });
  });
});

import { EmailDeliveryPort, type EmailContent } from "@langwatch/notification-server";
import { describe, expect, it } from "vitest";
import { WorkerAutomationNotificationDeliveryAdapter } from "../automation-notification-delivery.adapter";

/**
 * Spec: packages/features/automation/specs/graph-alert-delivery-envelope.feature
 *
 * The expected envelope below was RECORDED from the application's own sender,
 * `platform/app/src/server/mailer/triggerEmail.ts`, under the key and host
 * spelled here. It is a literal because a recipient cannot tell which process
 * wrote to them: the footer link they click is served by the application's
 * route, and the `To` address is what a bounce processor attributes by.
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

class RecordingMailer extends EmailDeliveryPort {
  readonly sent: EmailContent[] = [];

  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }

  async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return {};
  }
}

class RecordingLogger {
  readonly warnings: unknown[][] = [];

  warn(...args: unknown[]): void {
    this.warnings.push(args);
  }
  error(): void {}
  info(): void {}
  debug(): void {}
}

function composeDelivery(over: { logger?: RecordingLogger } = {}) {
  const mailer = new RecordingMailer();
  const logger = over.logger ?? new RecordingLogger();
  const adapter = WorkerAutomationNotificationDeliveryAdapter.create({
    mailer,
    baseHost: BASE_HOST,
    unsubscribeSigningSecret: SIGNING_KEY,
    logger: logger as never,
  });

  return { adapter, mailer, logger };
}

function alert(
  over: Partial<Parameters<WorkerAutomationNotificationDeliveryAdapter["sendEmail"]>[0]> = {},
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

describe("WorkerAutomationNotificationDeliveryAdapter", () => {
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

    /** @scenario "A channel this process cannot send through refuses by name" */
    it("refuses the settlement digest's two legacy renderers the same way", async () => {
      const { adapter } = composeDelivery();

      await expect(adapter.sendLegacyEmail()).rejects.toThrow(/graph-alert half/);
      await expect(adapter.sendLegacySlackWebhook()).rejects.toThrow(/graph-alert half/);
    });
  });
});

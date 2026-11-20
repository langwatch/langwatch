/** Spec: modules/notification/specs/customer-io-transactional.feature */
import type { SendEmailCommand } from "@langwatch/notification-contract";
import type * as TestHarness from "@langwatch/test-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lines: [] as { level: number; msg?: string; [field: string]: unknown }[],
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const { logger, lines } = harness.createTestLogger();
  captured.lines = lines;
  return { ...(await importOriginal<object>()), createLogger: () => logger };
});

import {
  type EmailContent,
  EmailDelivery,
  type MailGatewaySettings,
} from "../../channels/email-delivery.channel.ts";
import {
  type CustomerIoMailRefusal,
  MemoryCustomerIoMailChannel,
} from "../../channels/memory/memory.customer-io-mail.channel.ts";
import { MailDeliveryService } from "../mail-delivery.service.ts";

const WARN_LEVEL = 40;
const DEFAULT_FROM = "LangWatch <contact@langwatch.test>";

const settings: MailGatewaySettings = {
  provider: undefined,
  ses: { enabled: false },
  sendgrid: {},
  smtp: {},
  resend: {},
};

/** The install's own mailer, recorded rather than delivered; told to fail, it refuses every send. */
class OwnMailer extends EmailDelivery {
  readonly sent: EmailContent[] = [];
  failure: Error | undefined;

  defaultFrom(): string {
    return DEFAULT_FROM;
  }

  async send(content: EmailContent): Promise<void> {
    if (this.failure) throw this.failure;
    this.sent.push(content);
  }
}

function compose() {
  const customerIo = MemoryCustomerIoMailChannel.create();
  const ownMailer = new OwnMailer();
  const mail = MailDeliveryService.create({
    settings: () => Promise.resolve(settings),
    delivery: ownMailer,
    customerIo,
  });
  return { customerIo, ownMailer, mail };
}

const usageLimit = (): SendEmailCommand => ({
  to: "ada@acme.test",
  subject: "You reached your plan's usage limit",
  html: "<p>Upgrade to keep tracing</p>",
  template: "usage-limit",
});

const warnings = () => captured.lines.filter((line) => line.level === WARN_LEVEL);

beforeEach(() => {
  captured.lines.length = 0;
});

describe("given Customer.io refuses a usage-limit send", () => {
  const refusals: [string, CustomerIoMailRefusal][] = [
    ["a 500", { outcome: "refused", reason: "status", status: 500 }],
    ["a 400", { outcome: "refused", reason: "status", status: 400 }],
    ["a 429", { outcome: "refused", reason: "status", status: 429 }],
    ["a timeout", { outcome: "refused", reason: "timeout" }],
    ["a network error", { outcome: "refused", reason: "network" }],
  ];

  describe.each(refusals)("when it answers with %s", (_name, refusal) => {
    /** @scenario "A failed usage-limit send still reaches the person" */
    it("sends it once through the own mailer, unchanged, and warns naming the template", async () => {
      const { customerIo, ownMailer, mail } = compose();
      customerIo.refuse(refusal);

      await mail.sendEmail(usageLimit());

      expect(customerIo.sent).toHaveLength(1);
      expect(ownMailer.sent).toEqual([
        {
          to: "ada@acme.test",
          subject: "You reached your plan's usage limit",
          html: "<p>Upgrade to keep tracing</p>",
        },
      ]);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toMatchObject({
        template: "usage-limit",
        reason: refusal.reason,
        ...(refusal.status === undefined ? {} : { status: refusal.status }),
      });
    });
  });

  describe("when the call to nurturing itself throws", () => {
    /** @scenario "A failed usage-limit send still reaches the person" */
    it("still sends it once through the own mailer", async () => {
      const { ownMailer } = compose();
      const mail = MailDeliveryService.create({
        settings: () => Promise.resolve(settings),
        delivery: ownMailer,
        customerIo: {
          send: () => Promise.reject(new Error("nurturing is not connected yet")),
        },
      });

      await mail.sendEmail(usageLimit());

      expect(ownMailer.sent).toHaveLength(1);
      expect(warnings()[0]).toMatchObject({ template: "usage-limit", reason: "unexpected" });
    });
  });
});

describe("given a routed message to two recipients", () => {
  describe("when Customer.io refuses the send to one of them", () => {
    /** @scenario "Only the recipient Customer.io refused falls back" */
    it("has the own mailer send to that recipient only", async () => {
      const { customerIo, ownMailer, mail } = compose();
      customerIo.refuse({ outcome: "refused", reason: "status", status: 503 }, "grace@acme.test");

      await mail.sendEmail({
        to: ["ada@acme.test", "grace@acme.test"],
        subject: "Usage limit reached",
        html: "<p>limit</p>",
        template: "usage-limit",
        idempotencyKey: "usage:org-1",
      });

      expect(customerIo.sent.map((email) => email.to)).toEqual([
        "ada@acme.test",
        "grace@acme.test",
      ]);
      expect(ownMailer.sent).toEqual([
        {
          to: "grace@acme.test",
          subject: "Usage limit reached",
          html: "<p>limit</p>",
          idempotencyKey: "usage:org-1:grace@acme.test",
        },
      ]);
    });
  });
});

describe("given a replyless trigger-digest message", () => {
  describe("when it is sent through Customer.io", () => {
    /** @scenario "A replyless digest reaches the real recipient and answers to no-reply" */
    it("hands Customer.io the real recipient, answering to the no-reply address", async () => {
      const { customerIo, ownMailer, mail } = compose();

      await mail.sendEmail({
        to: "ada@acme.test",
        replyless: { tag: "81d9d46cce00" },
        subject: "Trigger - Errors above threshold",
        html: "<p>digest</p>",
        template: "trigger-digest",
      });

      expect(customerIo.sent).toEqual([
        expect.objectContaining({
          identifiers: { email: "ada@acme.test" },
          to: "ada@acme.test",
          replyTo: "LangWatch Triggers <no-reply+81d9d46cce00@langwatch.test>",
        }),
      ]);
      expect(ownMailer.sent).toEqual([]);
    });
  });
});

describe("given Customer.io and the own mailer both refuse a routed send", () => {
  describe("when the message is sent", () => {
    /** @scenario "When both Customer.io and the own mailer fail the send fails with the own mailer's error" */
    it("rejects with the own mailer's error", async () => {
      const { customerIo, ownMailer, mail } = compose();
      customerIo.refuse({ outcome: "refused", reason: "status", status: 500 });
      const refusal = new Error("SMTP relay refused the message");
      ownMailer.failure = refusal;

      await expect(mail.sendEmail(usageLimit())).rejects.toBe(refusal);
    });
  });
});

describe("given a routed message with an unsubscribe link and a hidden recipient", () => {
  describe("when it is sent through Customer.io", () => {
    /** @scenario "The unsubscribe pair, the reply-to and hidden recipients reach Customer.io" */
    it("gives every recipient its own request carrying the one-click pair and the reply-to", async () => {
      const { customerIo, mail } = compose();

      await mail.sendEmail({
        to: "ada@acme.test",
        undisclosedRecipients: ["grace@acme.test"],
        replyless: { tag: "tag" },
        unsubscribe: { url: "https://app.langwatch.test/api/unsubscribe?token=t" },
        subject: "Trigger - Errors above threshold",
        html: "<p>digest</p>",
        template: "trigger-digest",
      });

      const shared = {
        transactionalMessageId: "trigger-digest",
        from: DEFAULT_FROM,
        subject: "Trigger - Errors above threshold",
        body: "<p>digest</p>",
        replyTo: "LangWatch Triggers <no-reply+tag@langwatch.test>",
        headers: {
          "List-Unsubscribe": "<https://app.langwatch.test/api/unsubscribe?token=t>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
      expect(customerIo.sent).toEqual([
        { ...shared, to: "ada@acme.test", identifiers: { email: "ada@acme.test" } },
        { ...shared, to: "grace@acme.test", identifiers: { email: "grace@acme.test" } },
      ]);
    });
  });

  describe("when the message also carries an attachment", () => {
    /** @scenario "Every other message stays on the own mailer on Cloud" */
    it("leaves it to the own mailer", async () => {
      const { customerIo, ownMailer, mail } = compose();

      await mail.sendEmail({
        ...usageLimit(),
        attachments: [{ filename: "usage.csv", content: "a,b", contentType: "text/csv" }],
      });

      expect(customerIo.sent).toEqual([]);
      expect(ownMailer.sent).toHaveLength(1);
    });
  });
});

describe("given a send through Customer.io that succeeds and one that falls back", () => {
  describe("when the log lines are read", () => {
    /** @scenario "No log line carries the key or a recipient address" */
    it("carries neither recipient address", async () => {
      const { customerIo, mail } = compose();
      await mail.sendEmail(usageLimit());
      customerIo.refuse({ outcome: "refused", reason: "network" });
      await mail.sendEmail({ ...usageLimit(), to: "Grace <grace@acme.test>" });

      const logged = JSON.stringify(captured.lines);
      expect(captured.lines.length).toBeGreaterThan(0);
      expect(logged).not.toContain("ada@acme.test");
      expect(logged).not.toContain("grace@acme.test");
    });
  });
});

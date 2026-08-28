import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryPort } from "~/server/mailer/providers/types";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock("~/server/mailer/emailSender", () => ({
  computeDefaultFrom: () => "LangWatch Triggers <no-reply@langwatch.ai>",
  sendEmail,
}));

vi.mock("~/runtime/app/features/automation-adapters/delivery/slackWebApi", () => ({
  postSlackChatMessage: vi.fn(),
}));

vi.mock("~/server/webhooks/sendWebhook", () => ({
  assertWebhookDelivered: vi.fn(),
  sendWebhook: vi.fn(),
}));

import { AppAutomationTestFireAdapter } from "../automation-test-fire.adapter";

describe("AppAutomationTestFireAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps test-fire recipients in bcc behind a trigger no-reply address", async () => {
    const mailer = new (class extends EmailDeliveryPort {
      defaultFrom(): string {
        return "LangWatch Triggers <no-reply@langwatch.ai>";
      }

      async send(): Promise<unknown> {
        return undefined;
      }
    })();
    const adapter = AppAutomationTestFireAdapter.create(mailer);

    await adapter.sendEmail({
      recipients: ["author@acme.test"],
      subject: "test fire",
      html: "<p>test</p>",
    });

    expect(sendEmail).toHaveBeenCalledWith({
      mailer,
      content: {
        to: expect.stringMatching(/^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/),
        bcc: ["author@acme.test"],
        subject: "test fire",
        html: "<p>test</p>",
      },
    });
  });
});

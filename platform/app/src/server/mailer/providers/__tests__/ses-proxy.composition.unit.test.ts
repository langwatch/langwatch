import { describe, expect, it, vi } from "vitest";

const { destroy, send } = vi.hoisted(() => ({ destroy: vi.fn(), send: vi.fn() }));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class SESClient {
    destroy = destroy;
    send = send;
  },
  SendEmailCommand: class SendEmailCommand {},
  SendRawEmailCommand: class SendRawEmailCommand {},
}));

import { SesEmailProvider } from "../ses";

describe("SesEmailProvider", () => {
  it("builds one client and releases it at provider shutdown", async () => {
    send.mockResolvedValue({ MessageId: "message" });
    const aws = { build: vi.fn(() => ({ requestHandler: {} })) };
    const provider = SesEmailProvider.create({
      configuration: { enabled: true, region: "eu-central-1" },
      aws,
    });

    await provider.send({
      content: { to: "one@example.com", subject: "one", html: "one" },
      defaultFrom: "from@example.com",
    });
    await provider.send({
      content: { to: "two@example.com", subject: "two", html: "two" },
      defaultFrom: "from@example.com",
    });
    await provider.close();

    expect(aws.build).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

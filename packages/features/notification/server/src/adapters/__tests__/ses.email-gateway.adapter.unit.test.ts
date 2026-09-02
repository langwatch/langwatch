import { beforeEach, describe, expect, it, vi } from "vitest";

const { destroy, send } = vi.hoisted(() => ({ destroy: vi.fn(), send: vi.fn() }));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    destroy = destroy;
    send = send;
  },
  SendEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
  SendRawEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

import { SesEmailGatewayAdapter } from "../ses.email-gateway.adapter";

/**
 * Spec: packages/features/notification/specs/packaged-mail-delivery.feature
 */
describe("given an SES deployment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({ MessageId: "message" });
  });

  describe("when the client configuration is built", () => {
    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("names the partition's own host so the proxy decision matches", () => {
      const aws = { build: vi.fn(() => ({ requestHandler: {} })) };
      SesEmailGatewayAdapter.buildClientConfig({
        configuration: { enabled: true, region: "cn-north-1" },
        aws,
      });
      expect(aws.build).toHaveBeenCalledWith({
        region: "cn-north-1",
        targetHost: "email.cn-north-1.amazonaws.com.cn",
        endpoint: undefined,
      });
    });

    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("lets an endpoint override decide both the SDK target and the proxy", () => {
      const aws = { build: vi.fn(() => ({ requestHandler: {} })) };
      SesEmailGatewayAdapter.buildClientConfig({
        configuration: {
          enabled: true,
          region: "eu-central-1",
          endpoint: "mail-relay.internal:465",
        },
        aws,
      });
      expect(aws.build).toHaveBeenCalledWith({
        region: "eu-central-1",
        targetHost: "mail-relay.internal:465",
        endpoint: "mail-relay.internal:465",
      });
    });
  });

  describe("when two messages are sent and the gateway is closed", () => {
    /** @scenario "Closing the capability releases the transport once" */
    it("builds one client and releases it once", async () => {
      const aws = { build: vi.fn(() => ({ requestHandler: {} })) };
      const gateway = SesEmailGatewayAdapter.create({
        configuration: { enabled: true, region: "eu-central-1" },
        aws,
      });
      await gateway.send({
        content: { to: "one@acme.example", subject: "one", html: "one" },
        defaultFrom: "noreply@acme.example",
      });
      await gateway.send({
        content: { to: "two@acme.example", subject: "two", html: "two" },
        defaultFrom: "noreply@acme.example",
      });
      await gateway.close();

      expect(aws.build).toHaveBeenCalledOnce();
      expect(destroy).toHaveBeenCalledOnce();
    });
  });

  describe("when a message carries blind recipients", () => {
    /** @scenario "Blind recipients never reach the rendered headers" */
    it("delivers them as BCC destinations rather than rendering them", async () => {
      const aws = { build: vi.fn(() => ({ requestHandler: {} })) };
      const gateway = SesEmailGatewayAdapter.create({
        configuration: { enabled: true, region: "eu-central-1" },
        aws,
      });
      await gateway.send({
        content: {
          to: ["public@acme.example"],
          bcc: ["hidden@acme.example"],
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        defaultFrom: "noreply@acme.example",
      });
      const command = send.mock.calls[0]?.[0] as {
        input: { Destination: { ToAddresses: string[]; BccAddresses?: string[] } };
      };
      expect(command.input.Destination.ToAddresses).toEqual(["public@acme.example"]);
      expect(command.input.Destination.BccAddresses).toEqual(["hidden@acme.example"]);
    });

    /** @scenario "A crafted header cannot inject another one" */
    it("takes the raw-MIME path whenever custom headers are present", async () => {
      const aws = { build: vi.fn(() => ({ requestHandler: {} })) };
      const gateway = SesEmailGatewayAdapter.create({
        configuration: { enabled: true, region: "eu-central-1" },
        aws,
      });
      await gateway.send({
        content: {
          to: ["public@acme.example"],
          bcc: ["hidden@acme.example"],
          subject: "Alert",
          html: "<p>Alert</p>",
          headers: { "List-Unsubscribe": "<https://acme.example/unsubscribe>" },
        },
        defaultFrom: "noreply@acme.example",
      });
      const command = send.mock.calls[0]?.[0] as {
        input: { RawMessage: { Data: Uint8Array }; Destinations: string[] };
      };
      const raw = new TextDecoder().decode(command.input.RawMessage.Data);
      expect(raw).toContain("To: public@acme.example");
      expect(raw).not.toContain("hidden@acme.example");
      expect(command.input.Destinations).toEqual(["public@acme.example", "hidden@acme.example"]);
    });
  });
});

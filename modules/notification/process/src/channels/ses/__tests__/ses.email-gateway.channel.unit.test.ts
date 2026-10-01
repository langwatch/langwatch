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

import { AwsClientConfiguration } from "@langwatch/aws-client";

import { emailProxyResolver, SesEmailGatewayChannel } from "../ses.email-gateway.channel.ts";

const directSesClientConfiguration = AwsClientConfiguration.create({
  outboundProxy: emailProxyResolver({}),
});

/**
 * Spec: modules/notification/specs/packaged-mail-delivery.feature
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
      SesEmailGatewayChannel.buildClientConfig({
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
      SesEmailGatewayChannel.buildClientConfig({
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
      const gateway = SesEmailGatewayChannel.create({
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
      const gateway = SesEmailGatewayChannel.create({
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
      const gateway = SesEmailGatewayChannel.create({
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

  describe("when a message carries the full surface", () => {
    /** @scenario "The full message surface survives every gateway" */
    it("sends attachments, reply-to and headers, and keeps the blind copy out of the headers", async () => {
      const gateway = SesEmailGatewayChannel.create({
        configuration: { enabled: true, region: "eu-central-1" },
        aws: { build: vi.fn(() => ({ requestHandler: {} })) },
      });
      await gateway.send({
        content: {
          to: ["public@acme.example"],
          bcc: ["hidden@acme.example"],
          replyTo: "help@acme.example",
          subject: "Report",
          html: "<p>Report</p>",
          headers: { "X-Report": "weekly" },
          attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
        },
        defaultFrom: "noreply@acme.example",
      });
      const command = send.mock.calls[0]?.[0] as {
        input: { RawMessage: { Data: Uint8Array }; Destinations: string[] };
      };
      const raw = new TextDecoder().decode(command.input.RawMessage.Data);

      expect(raw).toContain("Reply-To: help@acme.example");
      expect(raw).toContain("X-Report: weekly");
      expect(raw).toContain('Content-Disposition: attachment; filename="report.csv"');
      expect(raw).not.toContain("hidden@acme.example");
      expect(command.input.Destinations).toContain("hidden@acme.example");
    });
  });

  describe("when an attachment is named in another alphabet", () => {
    /** @scenario "An attachment named in a non-English alphabet keeps its name" */
    it("carries the accented name and a plain ASCII fallback", async () => {
      const gateway = SesEmailGatewayChannel.create({
        configuration: { enabled: true, region: "eu-central-1" },
        aws: { build: vi.fn(() => ({ requestHandler: {} })) },
      });
      await gateway.send({
        content: {
          to: "public@acme.example",
          subject: "Relatório",
          html: "<p>Relatório</p>",
          attachments: [{ filename: "relatório.csv", content: "a,b", contentType: "text/csv" }],
        },
        defaultFrom: "noreply@acme.example",
      });
      const command = send.mock.calls[0]?.[0] as { input: { RawMessage: { Data: Uint8Array } } };
      const raw = new TextDecoder().decode(command.input.RawMessage.Data);

      expect(raw).toContain(`filename*=UTF-8''relat%C3%B3rio.csv`);
      expect(raw).toContain('filename="relat_rio.csv"');
    });
  });

  describe("when the operator names a custom SES endpoint", () => {
    /** @scenario "Operator overrides the SES endpoint" */
    it("hands the client that endpoint instead of the public one", () => {
      expect(
        directSesClientConfiguration.build({
          region: "eu-central-1",
          targetHost: "ses.internal:8443",
          endpoint: "https://ses.internal:8443",
        }),
      ).toMatchObject({ region: "eu-central-1", endpoint: "https://ses.internal:8443" });
      expect(
        directSesClientConfiguration.build({ region: "eu-central-1", targetHost: "email.x" }),
      ).not.toHaveProperty("endpoint");
    });
  });

  describe("when an outbound proxy is configured", () => {
    const proxy = { httpsProxy: "http://proxy.corp:8080", noProxy: ".internal.corp" };

    /** @scenario "Email egress follows the configured outbound proxy" */
    it("routes the SES host through the proxy", () => {
      expect(emailProxyResolver(proxy).tryResolveForHost("email.eu-central-1.amazonaws.com")).toBe(
        "http://proxy.corp:8080",
      );
    });

    /** @scenario "Hosts excluded from proxying are contacted directly" */
    it("contacts an excluded endpoint directly", () => {
      expect(emailProxyResolver(proxy).tryResolveForHost("ses.internal.corp")).toBeUndefined();
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import dns from "node:dns/promises";

import { SQSClient } from "@aws-sdk/client-sqs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SqsSecurityLakeQueueChannel } from "../sqs.security-lake-queue.channel.ts";

const credentials = { accessKeyId: "AKIA-test", secretAccessKey: "secret" };

describe("SqsSecurityLakeQueueChannel", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("given a queue URL on the cloud metadata address", () => {
    it("refuses before any request leaves the process", async () => {
      const send = vi.spyOn(SQSClient.prototype, "send");

      await expect(
        SqsSecurityLakeQueueChannel.create().probe({
          queueUrl: "http://169.254.169.254/123456789012/acme-subscriber",
          region: "eu-west-1",
          credentials,
        }),
      ).rejects.toThrow(/metadata/);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("given a regional queue URL", () => {
    it("lets the probe reach the queue", async () => {
      vi.spyOn(SQSClient.prototype, "send").mockImplementation(async () => ({
        Attributes: {
          ApproximateNumberOfMessages: "2",
          ApproximateNumberOfMessagesNotVisible: "1",
        },
      }));

      await expect(
        SqsSecurityLakeQueueChannel.create().probe({
          queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
          region: "eu-west-1",
          credentials,
        }),
      ).resolves.toEqual({ waiting: 2, inFlight: 1 });
    });
  });

  describe.each(["eu-west-1", "us-east-1"])("given no endpoint override in %s", (region) => {
    it.each([
      `https://sqs.${region}.amazonaws.com/123456789012/acme-subscriber`,
      `https://${region}.queue.amazonaws.com/123456789012/acme-subscriber`,
    ])("reaches the AWS queue %s", async (queueUrl) => {
      vi.spyOn(SQSClient.prototype, "send").mockImplementation(async () => ({ Attributes: {} }));

      await expect(
        SqsSecurityLakeQueueChannel.create().probe({ queueUrl, region, credentials }),
      ).resolves.toEqual({ waiting: 0, inFlight: 0 });
    });
  });

  describe("given an endpoint override", () => {
    const queueUrl = "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber";

    it("refuses the cloud metadata address", async () => {
      const send = vi.spyOn(SQSClient.prototype, "send");
      await expect(
        SqsSecurityLakeQueueChannel.create().probe({
          queueUrl,
          region: "eu-west-1",
          endpoint: "http://169.254.169.254",
          credentials,
        }),
      ).rejects.toThrow(/metadata/);
      expect(send).not.toHaveBeenCalled();
    });

    describe("given the override is a VPC endpoint", () => {
      const vpce = "https://vpce-0a1b2c3d-x1y2z3.sqs.eu-west-1.vpce.amazonaws.com";
      const resolvesTo = (address: string) =>
        vi
          .spyOn(dns, "resolve")
          .mockImplementation((async (_host: string, type: string) =>
            type === "A" ? [address] : []) as never);

      it("reaches the queue when the endpoint resolves to a public address", async () => {
        resolvesTo("52.95.110.10");
        vi.spyOn(SQSClient.prototype, "send").mockImplementation(async () => ({ Attributes: {} }));

        await expect(
          SqsSecurityLakeQueueChannel.create().probe({
            queueUrl: `${vpce}/123456789012/acme-subscriber`,
            region: "eu-west-1",
            endpoint: vpce,
            credentials,
          }),
        ).resolves.toEqual({ waiting: 0, inFlight: 0 });
      });

      it.each([
        ["a private address", "10.0.5.3", /private or localhost/],
        ["loopback", "127.0.0.1", /private or localhost/],
        ["the metadata endpoint", "169.254.169.254", /metadata/],
      ])("refuses it when it resolves to %s", async (_, address, error) => {
        resolvesTo(address);
        const send = vi.spyOn(SQSClient.prototype, "send");

        await expect(
          SqsSecurityLakeQueueChannel.create().probe({
            queueUrl,
            region: "eu-west-1",
            endpoint: vpce,
            credentials,
          }),
        ).rejects.toThrow(error);
        expect(send).not.toHaveBeenCalled();
      });
    });

    it("refuses localhost under the default policy", async () => {
      const send = vi.spyOn(SQSClient.prototype, "send");
      await expect(
        SqsSecurityLakeQueueChannel.create().probe({
          queueUrl,
          region: "eu-west-1",
          endpoint: "http://localhost:4566",
          credentials,
        }),
      ).rejects.toThrow(/private or localhost/);
      expect(send).not.toHaveBeenCalled();
    });
  });
});

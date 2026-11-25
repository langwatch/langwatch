// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import dns from "node:dns/promises";

import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { S3ObjectStoreChannel } from "../s3.object-store.channel.ts";

const credentials = { accessKeyId: "AKIA-test", secretAccessKey: "secret" };

function listInput(region: string, endpoint?: string) {
  return {
    bucket: "aws-security-data-lake-acme",
    prefix: "",
    region,
    endpoint,
    credentials,
    limit: 10,
  };
}

describe("S3ObjectStoreChannel endpoint fence", () => {
  afterEach(() => vi.restoreAllMocks());

  describe.each(["eu-west-1", "us-east-1"])("given no endpoint override in %s", (region) => {
    it("reaches the regional AWS host through the SDK's own resolution", async () => {
      const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async function (
        this: S3Client,
      ) {
        expect(this.config.forcePathStyle).toBe(false);
        expect(await this.config.region()).toBe(region);
        return { Contents: [{ Key: "a.parquet" }], IsTruncated: false };
      });

      await expect(S3ObjectStoreChannel.create().list(listInput(region))).resolves.toEqual({
        keys: ["a.parquet"],
        isTruncated: false,
      });
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an endpoint override", () => {
    it("refuses the cloud metadata address", async () => {
      const send = vi.spyOn(S3Client.prototype, "send");
      await expect(
        S3ObjectStoreChannel.create().list(listInput("eu-west-1", "http://169.254.169.254")),
      ).rejects.toThrow(/metadata/);
      expect(send).not.toHaveBeenCalled();
    });

    describe("given the override is an S3 VPC endpoint", () => {
      const vpce = "https://bucket.vpce-0a1b2c3d-x1y2z3.s3.eu-west-1.vpce.amazonaws.com";
      const resolvesTo = (address: string) =>
        vi
          .spyOn(dns, "resolve")
          .mockImplementation((async (_host: string, type: string) =>
            type === "A" ? [address] : []) as never);

      it("lists the bucket when the endpoint resolves to a public address", async () => {
        resolvesTo("52.218.1.10");
        vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
          Contents: [],
          IsTruncated: false,
        }));

        await expect(
          S3ObjectStoreChannel.create().list(listInput("eu-west-1", vpce)),
        ).resolves.toEqual({ keys: [], isTruncated: false });
      });

      it.each([
        ["a private address", "10.0.5.3", /private or localhost/],
        ["loopback", "127.0.0.1", /private or localhost/],
        ["the metadata endpoint", "169.254.169.254", /metadata/],
      ])("refuses it when it resolves to %s", async (_, address, error) => {
        resolvesTo(address);
        const send = vi.spyOn(S3Client.prototype, "send");

        await expect(
          S3ObjectStoreChannel.create().list(listInput("eu-west-1", vpce)),
        ).rejects.toThrow(error);
        expect(send).not.toHaveBeenCalled();
      });
    });

    it("refuses localhost under the default policy", async () => {
      const send = vi.spyOn(S3Client.prototype, "send");
      await expect(
        S3ObjectStoreChannel.create().list(listInput("eu-west-1", "http://localhost:4566")),
      ).rejects.toThrow(/private or localhost/);
      expect(send).not.toHaveBeenCalled();
    });

    it("lets localhost through when the pull egress policy allows local addresses", async () => {
      vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
        Contents: [],
        IsTruncated: false,
      }));
      await expect(
        S3ObjectStoreChannel.create({ egress: { blockLocal: false, allowedHosts: [] } }).list(
          listInput("eu-west-1", "http://127.0.0.1:4566"),
        ),
      ).resolves.toEqual({ keys: [], isTruncated: false });
    });
  });
});

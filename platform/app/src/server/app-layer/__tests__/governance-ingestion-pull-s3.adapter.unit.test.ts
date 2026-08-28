import { beforeEach, describe, expect, it, vi } from "vitest";

const { client, s3Client } = vi.hoisted(() => {
  const client = { destroy: vi.fn(), send: vi.fn() };
  return {
    client,
    s3Client: vi.fn(function MockS3Client() {
      return client;
    }),
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {},
  ListObjectsV2Command: class ListObjectsV2Command {},
  S3Client: s3Client,
}));

import { AppGovernanceObjectStoragePort } from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import { AppGovernanceIngestionPullHost } from "../governance-ingestion-pull.host";

function createObjects(input: { proxy?: string; region: string; endpoint?: string }) {
  const aws = AppAwsClientConfiguration.create({ httpsProxy: input.proxy });
  const build = vi.spyOn(aws, "build");
  const host = AppGovernanceIngestionPullHost.create(MemoryFeatureFlagService.create(), aws);
  const objects = AppGovernanceObjectStoragePort.create(host);
  return { aws, build, objects };
}

describe("governance ingestion-pull S3 composition", () => {
  beforeEach(() => {
    client.destroy.mockClear();
    client.send.mockReset();
    s3Client.mockClear();
  });

  it("passes static credentials and the regional target through the API AWS policy", async () => {
    const { aws, build, objects } = createObjects({
      proxy: "http://proxy.example.test:8080",
      region: "eu-west-1",
      credentials: {
        accessKeyId: "access",
        secretAccessKey: "secret",
        sessionToken: "session",
      },
    });
    client.send.mockResolvedValue({ Contents: [], IsTruncated: false });

    await objects.list({
      bucket: "audit",
      prefix: "events/",
      region: "eu-west-1",
      credentials: { accessKeyId: "access", secretAccessKey: "secret", sessionToken: "session" },
      limit: 10,
    });

    expect(build).toHaveBeenCalledWith({
      region: "eu-west-1",
      endpoint: undefined,
      targetHost: "s3.eu-west-1.amazonaws.com",
      staticCredentials: {
        accessKeyId: "access",
        secretAccessKey: "secret",
        sessionToken: "session",
      },
    });
    expect(s3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: "access", secretAccessKey: "secret", sessionToken: "session" },
        forcePathStyle: false,
      }),
    );
    expect(client.destroy).toHaveBeenCalledOnce();

    await aws.close();
  });

  it("uses the China partition hostname before proxy routing", async () => {
    const { aws, build, objects } = createObjects({ region: "cn-north-1" });
    client.send.mockResolvedValue({ Contents: [], IsTruncated: false });

    await objects.list({
      bucket: "audit",
      prefix: "",
      region: "cn-north-1",
      credentials: {},
      limit: 1,
    });

    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ targetHost: "s3.cn-north-1.amazonaws.com.cn" }),
    );
    await aws.close();
  });

  it("uses a configured custom endpoint for proxy routing and path-style requests", async () => {
    const { aws, build, objects } = createObjects({ region: "auto" });
    client.send.mockResolvedValue({ Contents: [], IsTruncated: false });

    await objects.list({
      bucket: "audit",
      prefix: "",
      region: "auto",
      endpoint: "https://objects.internal.example.test",
      credentials: {},
      limit: 1,
    });

    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://objects.internal.example.test",
        targetHost: "https://objects.internal.example.test",
      }),
    );
    expect(s3Client).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
    await aws.close();
  });

  it("allows client destruction without closing the process-owned AWS transport", async () => {
    const { aws, objects } = createObjects({ region: "eu-west-1" });
    client.send.mockResolvedValue({ Contents: [], IsTruncated: false });

    await objects.list({
      bucket: "audit",
      prefix: "",
      region: "eu-west-1",
      credentials: {},
      limit: 1,
    });

    expect(() => aws.build({ targetHost: "s3.eu-west-1.amazonaws.com" })).not.toThrow();
    await aws.close();
  });
});

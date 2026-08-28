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
  DeleteObjectCommand: class DeleteObjectCommand {},
  GetObjectCommand: class GetObjectCommand {},
  HeadObjectCommand: class HeadObjectCommand {},
  PutObjectCommand: class PutObjectCommand {},
  S3Client: s3Client,
}));

import { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import { MigrationS3StorageDriver } from "../migrate-object-storage.aws.adapter";

describe("MigrationS3StorageDriver", () => {
  beforeEach(() => {
    client.destroy.mockClear();
    client.send.mockClear();
    s3Client.mockClear();
  });

  it("routes an ordinary regional AWS endpoint through the process AWS policy", () => {
    const aws = AppAwsClientConfiguration.create({});
    const build = vi.spyOn(aws, "build");

    MigrationS3StorageDriver.create({
      aws,
      config: {
        bucket: "migration",
        region: "eu-west-1",
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
    });

    expect(build).toHaveBeenCalledWith({
      region: "eu-west-1",
      endpoint: undefined,
      targetHost: "s3.eu-west-1.amazonaws.com",
      staticCredentials: {
        accessKeyId: "access",
        secretAccessKey: "secret",
        sessionToken: undefined,
      },
    });
  });

  it("uses the China S3 hostname when the migration region is in that partition", () => {
    const aws = AppAwsClientConfiguration.create({});
    const build = vi.spyOn(aws, "build");

    MigrationS3StorageDriver.create({
      aws,
      config: { bucket: "migration", region: "cn-north-1" },
    });

    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ targetHost: "s3.cn-north-1.amazonaws.com.cn" }),
    );
  });

  it("uses the custom endpoint as the proxy-policy target and retains path style", () => {
    const aws = AppAwsClientConfiguration.create({});
    const build = vi.spyOn(aws, "build");

    const driver = MigrationS3StorageDriver.create({
      aws,
      config: {
        bucket: "migration",
        endpoint: "https://objects.internal.example.test",
      },
    });

    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://objects.internal.example.test",
        region: "auto",
        targetHost: "https://objects.internal.example.test",
      }),
    );
    expect(s3Client).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));

    driver.close();
    expect(client.destroy).toHaveBeenCalledOnce();
  });
});

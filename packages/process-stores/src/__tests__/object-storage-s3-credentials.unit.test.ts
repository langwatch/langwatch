/**
 * @see specs/private-dataplane/s3-routing.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { s3Client } from "../object-storage-s3.ts";

const webIdentity = vi.hoisted(() => {
  const identity = { accessKeyId: "from-web-identity", secretAccessKey: "assumed" };
  const fromTokenFile = vi.fn((_options: { roleArn: string }) => async () => identity);

  return { identity, fromTokenFile };
});

vi.mock("@aws-sdk/credential-providers", () => ({ fromTokenFile: webIdentity.fromTokenFile }));

const ROLE = "arn:aws:iam::1:role/acme-dataplane";
const keys = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" };
const account = { bucket: "acme-dataplane", region: "eu-west-1" };

beforeEach(() => {
  webIdentity.fromTokenFile.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("given an S3 account, when its client is constructed", () => {
  describe("when the account names a role", () => {
    /** @scenario "A private S3 config naming a role is read through the web identity" */
    it("signs with the web-identity provider for that role", async () => {
      const client = s3Client({ ...account, roleArn: ROLE });

      expect(webIdentity.fromTokenFile).toHaveBeenCalledWith({ roleArn: ROLE });
      await expect(client.config.credentials()).resolves.toMatchObject(webIdentity.identity);
    });

    /** @scenario "A private S3 config naming a role is read through the web identity" */
    it("prefers the role over a key pair the account also carries", async () => {
      const client = s3Client({ ...account, roleArn: ROLE, credentials: keys });

      expect(webIdentity.fromTokenFile).toHaveBeenCalledWith({ roleArn: ROLE });
      await expect(client.config.credentials()).resolves.toMatchObject(webIdentity.identity);
    });

    /** @scenario "A private S3 config naming a role is read through the web identity" */
    it("leaves an AWS endpoint's region to the SDK rather than the 'auto' default", async () => {
      vi.stubEnv("AWS_REGION", "eu-central-1");
      const client = s3Client({ bucket: "acme-dataplane", roleArn: ROLE, credentials: keys });

      await expect(client.config.region()).resolves.toBe("eu-central-1");
    });

    it("leaves an AWS China endpoint's region to the SDK too", async () => {
      vi.stubEnv("AWS_REGION", "cn-north-1");
      const client = s3Client({
        bucket: "acme-dataplane",
        endpoint: "https://s3.cn-north-1.amazonaws.com.cn",
        roleArn: ROLE,
      });

      await expect(client.config.region()).resolves.toBe("cn-north-1");
    });

    it("reads an AWS endpoint by its hostname, so a trailing slash still counts", async () => {
      vi.stubEnv("AWS_REGION", "cn-north-1");
      const client = s3Client({
        bucket: "acme-dataplane",
        endpoint: "https://s3.cn-north-1.amazonaws.com.cn/",
        roleArn: ROLE,
      });

      await expect(client.config.region()).resolves.toBe("cn-north-1");
    });

    it("keeps the 'auto' region for an endpoint that is not AWS", async () => {
      vi.stubEnv("AWS_REGION", "eu-central-1");
      const client = s3Client({
        bucket: "acme-dataplane",
        endpoint: "https://minio.internal:9000/",
        roleArn: ROLE,
      });

      await expect(client.config.region()).resolves.toBe("auto");
    });
  });

  describe("when the account carries only a key pair", () => {
    /** @scenario "Parse private S3 config from env var" */
    it("signs with that key pair and reads no web identity", async () => {
      const client = s3Client({ ...account, credentials: keys });

      expect(webIdentity.fromTokenFile).not.toHaveBeenCalled();
      await expect(client.config.credentials()).resolves.toMatchObject(keys);
    });
  });

  describe("when the account carries neither a role nor a key pair", () => {
    it("leaves the credentials to the SDK's default chain", async () => {
      vi.stubEnv("AWS_ACCESS_KEY_ID", "from-default-chain");
      vi.stubEnv("AWS_SECRET_ACCESS_KEY", "chain-secret");
      const client = s3Client(account);

      expect(webIdentity.fromTokenFile).not.toHaveBeenCalled();
      await expect(client.config.credentials()).resolves.toMatchObject({
        accessKeyId: "from-default-chain",
      });
    });
  });
});

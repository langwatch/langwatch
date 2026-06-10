/**
 * Unit tests for `createS3Client` credential mode handling.
 *
 * Three production-relevant auth modes the chart + the dev/SSO local
 * workflow exercise:
 *
 *   1. Static IAM-user keys via env (long-lived AKIA + secret, no token)
 *   2. Temporary STS credentials via env (ASIA + secret + session-token)
 *   3. Keyless (IRSA / EKS web-identity / EC2 instance-profile / ECS
 *      task-role / ~/.aws/credentials default chain)
 *
 * Pre-PR-4058 the function always passed `credentials: {...}` even when
 * the env vars were empty strings, which short-circuited the SDK default
 * chain and silently broke IRSA in production EKS deployments. The
 * `hasExplicitKeys` gate fixes that.
 *
 * We assert the constructor call shape rather than mocking the SDK
 * deeply, because the shape is the contract — the SDK does the actual
 * resolution from there.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const s3ClientConstructorCalls: any[] = [];

vi.mock("@aws-sdk/client-s3", () => {
  class FakeS3Client {
    config: any;
    constructor(config: any) {
      s3ClientConstructorCalls.push(config);
      this.config = config;
    }
  }
  return {
    S3Client: FakeS3Client,
    GetObjectCommand: class {},
    PutObjectCommand: class {},
  };
});

vi.mock("../dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn(async () => null),
}));

vi.mock("../stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: vi.fn(async () => ({
    kind: "s3",
    bucket: "test-bucket",
  })),
}));

vi.mock("../../env.mjs", () => ({
  env: new Proxy(
    {},
    {
      get: (_target, key: string) => {
        const map: Record<string, string | undefined> = {
          S3_ENDPOINT: process.env.S3_ENDPOINT,
          S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
          S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
          S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN,
          S3_REGION: process.env.S3_REGION,
          S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
          LANGWATCH_LOCAL_STORAGE_PATH:
            process.env.LANGWATCH_LOCAL_STORAGE_PATH,
        };
        return map[key];
      },
    },
  ),
}));

describe("createS3Client credential mode handling", () => {
  beforeEach(() => {
    s3ClientConstructorCalls.length = 0;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_SESSION_TOKEN;
    delete process.env.S3_REGION;
    delete process.env.S3_BUCKET_NAME;
  });

  describe("given static IAM-user keys (AKIA + secret, no token)", () => {
    /** @scenario "S3 client uses explicit credentials when env keys are present" */
    it("passes credentials with no sessionToken", async () => {
      process.env.S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
      process.env.S3_SECRET_ACCESS_KEY = "secret-value";
      process.env.S3_ENDPOINT = "https://s3.example.com";

      vi.resetModules();
      const { createS3Client } = await import("../storage");
      await createS3Client("test-project");

      expect(s3ClientConstructorCalls).toHaveLength(1);
      const config = s3ClientConstructorCalls[0];
      expect(config.credentials).toEqual({
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret-value",
      });
      expect(config.credentials.sessionToken).toBeUndefined();
    });
  });

  describe("given temporary STS credentials (ASIA + secret + sessionToken)", () => {
    /** @scenario "S3 client forwards sessionToken when set so SSO/STS credentials work" */
    it("includes sessionToken in credentials", async () => {
      process.env.S3_ACCESS_KEY_ID = "ASIAEXAMPLE";
      process.env.S3_SECRET_ACCESS_KEY = "secret-value";
      process.env.S3_SESSION_TOKEN = "FwoGZXIvYXdzEDoaDAQexampleToken";
      process.env.S3_ENDPOINT = "https://s3.example.com";

      vi.resetModules();
      const { createS3Client } = await import("../storage");
      await createS3Client("test-project");

      expect(s3ClientConstructorCalls).toHaveLength(1);
      const config = s3ClientConstructorCalls[0];
      expect(config.credentials).toEqual({
        accessKeyId: "ASIAEXAMPLE",
        secretAccessKey: "secret-value",
        sessionToken: "FwoGZXIvYXdzEDoaDAQexampleToken",
      });
    });
  });

  describe("given no credential env vars (IRSA / instance-profile / default chain)", () => {
    /** @scenario "S3 client omits credentials so the SDK default provider chain handles IRSA and instance profiles" */
    it("does NOT pass a credentials field, allowing SDK fallback", async () => {
      process.env.S3_ENDPOINT = "https://s3.example.com";

      vi.resetModules();
      const { createS3Client } = await import("../storage");
      await createS3Client("test-project");

      expect(s3ClientConstructorCalls).toHaveLength(1);
      const config = s3ClientConstructorCalls[0];
      // The presence-vs-absence of the credentials field is the contract:
      // when absent, the SDK consults its full provider chain
      // (web-identity, instance-profile, env, ini files, ECS metadata,
      // process credentials). When present-but-undefined the SDK throws.
      expect(config.credentials).toBeUndefined();
      expect("credentials" in config).toBe(false);
    });
  });

  describe("given S3_REGION env override", () => {
    /** @scenario "S3 client honors S3_REGION env for real AWS deployments instead of the R2/MinIO 'auto' default" */
    it("uses the configured region instead of 'auto'", async () => {
      process.env.S3_REGION = "eu-central-1";
      process.env.S3_ENDPOINT = "https://s3.eu-central-1.amazonaws.com";

      vi.resetModules();
      const { createS3Client } = await import("../storage");
      await createS3Client("test-project");

      expect(s3ClientConstructorCalls[0].region).toBe("eu-central-1");
    });
  });

  describe("given no S3_REGION env override", () => {
    /** @scenario "S3 client defaults region to 'auto' for R2 and MinIO compatibility" */
    it("defaults region to 'auto'", async () => {
      process.env.S3_ENDPOINT = "https://r2.cloudflarestorage.com";

      vi.resetModules();
      const { createS3Client } = await import("../storage");
      await createS3Client("test-project");

      expect(s3ClientConstructorCalls[0].region).toBe("auto");
    });
  });

  describe("given partial env vars (key but no secret)", () => {
    /** @scenario "S3 client falls back to default chain when credentials are partial — prevents misleading 'empty string credentials' bug" */
    it("falls back to SDK default chain rather than passing partial creds", async () => {
      process.env.S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
      // S3_SECRET_ACCESS_KEY intentionally absent
      process.env.S3_ENDPOINT = "https://s3.example.com";

      vi.resetModules();
      const { createS3Client } = await import("../storage");
      await createS3Client("test-project");

      const config = s3ClientConstructorCalls[0];
      expect(config.credentials).toBeUndefined();
      expect("credentials" in config).toBe(false);
    });
  });
});

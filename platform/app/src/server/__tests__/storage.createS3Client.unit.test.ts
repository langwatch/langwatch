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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createS3Client } from "../storage";

const s3ClientConstructorCalls: any[] = [];
type AwsClientConfigInput = {
  region?: string;
  targetHost: string;
  endpoint?: string;
  staticCredentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
};
const awsClientConfigCalls: AwsClientConfigInput[] = [];
const storageDestinationMock = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "s3" as const, bucket: "test-bucket" })),
);

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
  resolveProjectStorageDestination: storageDestinationMock,
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
          LANGWATCH_LOCAL_STORAGE_PATH: process.env.LANGWATCH_LOCAL_STORAGE_PATH,
        };
        return map[key];
      },
    },
  ),
}));

vi.mock("~/runtime/app/aws-client.composition", () => ({
  buildAwsClientConfig: vi.fn((input: AwsClientConfigInput) => {
    awsClientConfigCalls.push(input);
    return {
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      ...(input.staticCredentials !== undefined ? { credentials: input.staticCredentials } : {}),
    };
  }),
}));

function resetS3Env() {
  s3ClientConstructorCalls.length = 0;
  awsClientConfigCalls.length = 0;
  storageDestinationMock.mockReset();
  storageDestinationMock.mockResolvedValue({ kind: "s3", bucket: "test-bucket" });
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete process.env.S3_SESSION_TOKEN;
  delete process.env.S3_REGION;
  delete process.env.S3_BUCKET_NAME;
}

describe("createS3Client credential mode handling", () => {
  beforeEach(resetS3Env);

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

describe("process AWS client composition", () => {
  beforeEach(resetS3Env);

  it("uses the process-owned transport policy for the current project target", async () => {
    process.env.S3_ENDPOINT = "https://r2.example.test";
    process.env.S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.S3_SECRET_ACCESS_KEY = "secret-value";

    await createS3Client("test-project");

    expect(awsClientConfigCalls).toEqual([
      {
        region: "auto",
        targetHost: "https://r2.example.test",
        endpoint: "https://r2.example.test",
        staticCredentials: {
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret-value",
        },
      },
    ]);
  });

  it.each([
    ["a standard AWS region", "eu-central-1", "s3.eu-central-1.amazonaws.com"],
    ["AWS China", "cn-north-1", "s3.cn-north-1.amazonaws.com.cn"],
    ["the compatibility auto region", "auto", "s3.amazonaws.com"],
  ])("uses %s's actual default S3 host for proxy selection", async (_, region, targetHost) => {
    process.env.S3_REGION = region;

    await createS3Client("test-project");

    expect(awsClientConfigCalls).toEqual([
      {
        region,
        targetHost,
      },
    ]);
  });

  it("resolves the destination again for each operation instead of retaining a tenant target", async () => {
    storageDestinationMock.mockResolvedValueOnce({ kind: "s3", bucket: "first-bucket" });
    storageDestinationMock.mockResolvedValueOnce({ kind: "s3", bucket: "second-bucket" });

    const first = await createS3Client("test-project");
    const second = await createS3Client("test-project");

    expect(first.s3Bucket).toBe("first-bucket");
    expect(second.s3Bucket).toBe("second-bucket");
    expect(awsClientConfigCalls).toHaveLength(2);
  });
});

describe("region resolution — AWS endpoint, keyless (IRSA path)", () => {
  beforeEach(resetS3Env);

  describe("when no endpoint is set and no keys are provided", () => {
    it("omits region so SDK resolves from credential chain", async () => {
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call).not.toHaveProperty("region");
    });
  });

  describe("when endpoint is *.amazonaws.com and no keys are provided", () => {
    it("omits region so SDK resolves from credential chain", async () => {
      process.env.S3_ENDPOINT = "https://s3.eu-central-1.amazonaws.com";
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call).not.toHaveProperty("region");
    });
  });

  describe("when endpoint is AWS and explicit keys are provided (pre-#4058 compatibility path)", () => {
    it("falls back to 'auto' to preserve pre-#4058 ops-tooling behavior", async () => {
      process.env.S3_ACCESS_KEY_ID = "AKIAEXAMPLE";
      process.env.S3_SECRET_ACCESS_KEY = "secret-value";
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call.region).toBe("auto");
    });
  });
});

describe("region resolution — non-AWS endpoint (BYOC/R2/MinIO)", () => {
  beforeEach(resetS3Env);

  describe("when endpoint is Cloudflare R2", () => {
    it("uses 'auto' region", async () => {
      process.env.S3_ENDPOINT = "https://abc123.r2.cloudflarestorage.com";
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call.region).toBe("auto");
    });
  });

  describe("when endpoint is MinIO", () => {
    it("uses 'auto' region", async () => {
      process.env.S3_ENDPOINT = "http://minio:9000";
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call.region).toBe("auto");
    });
  });
});

describe("given the resolved destination is azure", () => {
  beforeEach(resetS3Env);

  async function importWithAzureDestination() {
    vi.resetModules();
    vi.doMock("../stored-objects/project-storage-destination", () => ({
      resolveProjectStorageDestination: vi.fn(async () => ({
        kind: "azure",
        accountName: "lwacct",
        container: "lw-container",
      })),
    }));
    vi.doMock("../dataplane-s3", () => ({
      getS3ConfigForProject: vi.fn(async () => null),
    }));
    const { createS3Client: createS3ClientFresh } = await import("../storage");
    return createS3ClientFresh;
  }

  // afterEach, not a call at the tail of each test: an assertion that throws
  // would skip the inline version and leak the module mock into the next test.
  afterEach(() => {
    vi.doUnmock("../stored-objects/project-storage-destination");
    vi.doUnmock("../dataplane-s3");
  });

  describe("when no S3_BUCKET_NAME is configured (azure-only install)", () => {
    /** @scenario "The legacy S3 client factory refuses an azure destination instead of inventing a bucket" */
    it("throws a configuration error identifying the azure backend instead of falling back to the langwatch bucket", async () => {
      const createS3ClientFresh = await importWithAzureDestination();

      await expect(createS3ClientFresh("test-project")).rejects.toThrow(/azure/i);
      expect(s3ClientConstructorCalls).toHaveLength(0);
    });
  });

  describe("when S3_BUCKET_NAME is still configured (S3→Azure migration)", () => {
    /** @scenario "Legacy S3 surfaces keep working during an S3-to-Azure migration" */
    it("keeps serving the legacy S3 bucket so pre-migration s3:// URIs, spool refs, and staged payloads stay readable", async () => {
      process.env.S3_BUCKET_NAME = "legacy-bucket";
      const createS3ClientFresh = await importWithAzureDestination();

      const { s3Bucket } = await createS3ClientFresh("test-project");

      // Legacy read paths (S3Driver.get on persisted s3:// URIs, the edge
      // spool's bucket+key reads, staged-payload fetches) must keep working
      // during a migration — blanket-throwing here would strand every
      // pre-migration object (PR #6092 review, concern 1).
      expect(s3Bucket).toBe("legacy-bucket");
      expect(s3ClientConstructorCalls).toHaveLength(1);
      // The hardcoded "langwatch" fallback is still never invented for azure.
      expect(s3Bucket).not.toBe("langwatch");
    });
  });
});

describe("region resolution — explicit S3_REGION always wins", () => {
  beforeEach(resetS3Env);

  describe("when S3_REGION is set for AWS endpoint without keys", () => {
    it("uses S3_REGION value", async () => {
      process.env.S3_REGION = "eu-central-1";
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call.region).toBe("eu-central-1");
    });
  });

  describe("when S3_REGION is set for BYOC endpoint", () => {
    it("uses S3_REGION value", async () => {
      process.env.S3_REGION = "us-east-1";
      process.env.S3_ENDPOINT = "http://minio:9000";
      await createS3Client("test-project");
      const call = s3ClientConstructorCalls[0];
      expect(call.region).toBe("us-east-1");
    });
  });
});

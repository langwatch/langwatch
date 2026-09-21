/**
 * @vitest-environment node
 * @integration
 *
 * Regression coverage for provider selection happening before scheme
 * dispatch. Azure can be selected globally while a tenant-owned BYOC S3
 * bucket still wins destination precedence. Building the registry must not
 * validate the inactive Azure branch before an s3:// URI is dispatched.
 */
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const { mockEnv, mockPrivateConfig, objects } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockPrivateConfig: {
    current: null as { bucket: string } | null,
  },
  objects: new Map<string, Buffer>(),
}));

vi.mock("~/env.mjs", () => ({ env: mockEnv }));

vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn(async () => mockPrivateConfig.current),
}));

vi.mock("~/server/storage", async () => {
  const { GetObjectCommand, PutObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );

  return {
    createS3Client: vi.fn(async () => ({
      s3Bucket: "unused-by-uri-driver",
      s3Client: {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof PutObjectCommand) {
            const { Bucket, Key, Body } = command.input;
            objects.set(`${Bucket}/${Key}`, Buffer.from(Body as Uint8Array));
            return {};
          }
          if (command instanceof GetObjectCommand) {
            const { Bucket, Key } = command.input;
            const body = objects.get(`${Bucket}/${Key}`);
            if (!body) {
              const error = new Error("missing");
              error.name = "NoSuchKey";
              throw error;
            }
            return { Body: Readable.from([body]) };
          }
          throw new Error("unexpected S3 command");
        }),
      },
    })),
  };
});

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      return (
        fn as (span: { setAttribute: ReturnType<typeof vi.fn> }) => unknown
      )({ setAttribute: vi.fn() });
    },
  }),
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { resolveProjectStorageDestination } from "../project-storage-destination";
import { createStorageRegistry } from "../stored-objects-factory";
import { mintS3Uri } from "../uri";

function resetTestState(): void {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  mockPrivateConfig.current = null;
  objects.clear();
}

async function roundTripS3Object(params: {
  projectId: string;
  expectedBucket: string;
}): Promise<{
  destination: Awaited<ReturnType<typeof resolveProjectStorageDestination>>;
  body: string;
}> {
  const destination = await resolveProjectStorageDestination(params.projectId);
  const registry = createStorageRegistry({ projectId: params.projectId });
  const uri = mintS3Uri({
    bucket: params.expectedBucket,
    projectId: params.projectId,
    sha256: "abc123",
  });
  await registry.put(uri, Buffer.from("payload"), "text/plain");

  const chunks: Buffer[] = [];
  for await (const chunk of await registry.get(uri)) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return {
    destination,
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

describe("inactive Azure configuration with S3 traffic", () => {
  /** @scenario "An invalid inactive Azure configuration does not block S3 traffic" */
  it("round-trips through the global S3 bucket", async () => {
    resetTestState();
    mockEnv.STORED_OBJECTS_BACKEND = "s3";
    mockEnv.S3_BUCKET_NAME = "global-bucket";
    mockEnv.AZURE_BLOB_AUTH_MODE = "sharedKey";
    mockEnv.AZURE_BLOB_ACCOUNT_NAME = "incomplete-account";

    expect(
      await roundTripS3Object({
        projectId: "global-project",
        expectedBucket: "global-bucket",
      }),
    ).toEqual({
      destination: { kind: "s3", bucket: "global-bucket" },
      body: "payload",
    });
  });

  /** @scenario "An invalid inactive Azure configuration does not block S3 traffic" */
  it("round-trips through the tenant's private S3 bucket", async () => {
    resetTestState();
    mockEnv.STORED_OBJECTS_BACKEND = "azure";
    mockEnv.AZURE_BLOB_AUTH_MODE = "sharedKey";
    mockEnv.AZURE_BLOB_ACCOUNT_NAME = "incomplete-account";
    mockPrivateConfig.current = { bucket: "private-bucket" };

    expect(
      await roundTripS3Object({
        projectId: "private-project",
        expectedBucket: "private-bucket",
      }),
    ).toEqual({
      destination: { kind: "s3", bucket: "private-bucket" },
      body: "payload",
    });
  });
});

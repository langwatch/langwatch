/**
 * Bytes going out to Azure Blob and coming back, through the real driver, the real registry dispatch and the real destination policy — an in-memory blob account stands in for the socket, and nothing above it is doubled.
 * @vitest-environment node
 * Spec: specs/features/scenarios/externalize-event-byte-content.feature
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { TieredBlobStore } from "@langwatch/group-queue/operational";
import { mintStoredObjectUri } from "@langwatch/stored-object-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AzureBlobStoredObjectDriverAdapter } from "../azure-blob.stored-object-driver.adapter";
import {
  StoredObjectAzureDestinationPort,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
} from "../stored-object-destination.policy";
import { StoredObjectStorageRegistry } from "../stored-object-storage.registry";
import { StoredObjectsService } from "../../services/stored-objects.service";
import type { StoredObject } from "../../repositories/stored-objects.row";
import type { StoredObjectsRepository } from "../../repositories/stored-objects.repository";
import type { StoredObjectsTelemetryPort } from "../../ports/stored-objects-telemetry.port";

const ACCOUNT = "lwacct";
const CONTAINER = "stored-objects";
const PROJECT_ID = "proj-1";

/**
 * An Azure Blob account at the HTTP boundary: PUT stores, GET returns, HEAD probes, DELETE
 * removes, and anything absent answers 404 the way the service expects. Only `fetch` is
 * replaced, so signing, URI parsing and scheme dispatch are all the production code.
 */
function installBlobAccount(): Map<string, Buffer> {
  const blobs = new Map<string, Buffer>();
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "PUT") {
      blobs.set(url, Buffer.from(init?.body as Uint8Array));
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      const existed = blobs.delete(url);
      return new Response(null, { status: existed ? 202 : 404 });
    }
    const stored = blobs.get(url);
    if (!stored) return new Response(null, { status: 404 });
    if (method === "HEAD") return new Response(null, { status: 200 });
    return new Response(stored, { status: 200 });
  }) as typeof fetch);
  return blobs;
}

function azureDriver(): AzureBlobStoredObjectDriverAdapter {
  return AzureBlobStoredObjectDriverAdapter.create({
    mode: "sharedKey",
    accountName: ACCOUNT,
    accountKey: Buffer.from("account-key").toString("base64"),
  });
}

/** Only the Azure arm can serve a request: an S3 or file dispatch is a failure. */
function azureOnlyRegistry(): StoredObjectStorageRegistry {
  const driver = azureDriver();
  const refuse = {
    get: async () => {
      throw new Error("no S3 or filesystem provider exists on this install");
    },
    put: async () => {
      throw new Error("no S3 or filesystem provider exists on this install");
    },
    delete: async () => {
      throw new Error("no S3 or filesystem provider exists on this install");
    },
    exists: async () => {
      throw new Error("no S3 or filesystem provider exists on this install");
    },
  };
  return new StoredObjectStorageRegistry({ s3: refuse, file: refuse, "azure-blob": driver });
}

class NoPrivateBucket extends StoredObjectProjectS3ConfigPort {
  async tryGet(): Promise<null> {
    return null;
  }
}

class ConfiguredAzure extends StoredObjectAzureDestinationPort {
  resolve() {
    return { accountName: ACCOUNT, container: CONTAINER };
  }
}

/** The one deployment both cases run on: azure selected, no S3 anywhere. */
function azureOnlyPolicy(): StoredObjectDestinationPolicy {
  return StoredObjectDestinationPolicy.create({
    selection: {
      backend: "azure",
      localFilesystemRoot: "/var/lib/langwatch/objects",
      azure: new ConfiguredAzure(),
    },
    projects: new NoPrivateBucket(),
  });
}

beforeEach(() => {
  installBlobAccount();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a deployment whose object storage is Azure Blob and nothing else", () => {
  describe("when scenario media is stored and read back", () => {
    /** @scenario "Scenario media round-trips through Azure Blob when azure is the configured backend" */
    it("writes the bytes to the azure account and streams the same bytes back", async () => {
      const bytes = Buffer.from("a scenario audio turn");
      const rows = new Map<string, StoredObject>();
      const policy = azureOnlyPolicy();
      const service = StoredObjectsService.create({
        repository: {
          insert: vi.fn(async ({ row }: { row: StoredObject }) => {
            rows.set(row.id, row);
          }),
          findById: vi.fn(async ({ id }: { id: string }) => rows.get(id) ?? null),
          findAllByProject: vi.fn(async () => []),
          deleteByProject: vi.fn(async () => undefined),
          deleteByIds: vi.fn(async () => undefined),
        } as unknown as StoredObjectsRepository,
        registry: azureOnlyRegistry(),
        mintStorageUri: async ({ projectId, sha256 }) =>
          mintStoredObjectUri({
            destination: await policy.resolve(projectId),
            objectPath: `${projectId}/${sha256}`,
          }),
        telemetry: {
          recordExtract: vi.fn(),
          recordDedupHit: vi.fn(),
          recordWriteFailure: vi.fn(),
          recordReadFailure: vi.fn(),
          observeSizeBytes: vi.fn(),
        } as unknown as StoredObjectsTelemetryPort,
      });

      const stored = await service.storeFromBytes({
        projectId: PROJECT_ID,
        purpose: "scenario_event",
        ownerKind: "scenario_run",
        ownerId: "run-1",
        mediaType: "audio/wav",
        bytes,
      });

      const row = rows.get(stored.id);
      expect(row?.storage_uri).toBe(
        `azure-blob://${ACCOUNT}/${CONTAINER}/${PROJECT_ID}/${createHash("sha256")
          .update(bytes)
          .digest("hex")}`,
      );

      const read = await service.getById({ projectId: PROJECT_ID, id: stored.id });
      expect(read && "stream" in read).toBe(true);
      await expect(drain((read as { stream: Readable }).stream)).resolves.toBe(bytes.toString());
    });
  });

  describe("when the groupQueue offloads an oversized envelope", () => {
    /** @scenario "The groupQueue durable blob tier works on an Azure-only install" */
    it("puts the bytes in Azure Blob under the durable tier and reads them back", async () => {
      const threshold = 64;
      const store = new TieredBlobStore({
        redisBlobs: {
          put: vi.fn(async () => undefined),
          get: vi.fn(async () => null),
          peek: vi.fn(async () => null),
          delete: vi.fn(async () => undefined),
        } as unknown as ConstructorParameters<typeof TieredBlobStore>[0]["redisBlobs"],
        objectStoreFor: () => azureOnlyRegistry(),
        resolveDestination: (projectId) => azureOnlyPolicy().resolve(projectId),
        s3ThresholdBytes: threshold,
      });
      const body = Buffer.from("x".repeat(threshold * 4));

      const ref = await store.put({
        projectId: PROJECT_ID,
        data: body,
        mediaType: "application/json",
      });

      // "s3" names the durable TIER, not the provider it landed on.
      expect(ref.tier).toBe("s3");
      const roundTripped = await store.get(ref);
      expect(await drain(roundTripped)).toBe(body.toString());
    });
  });
});

async function drain(stream: Readable | Buffer | null): Promise<string> {
  if (stream === null) return "";
  if (Buffer.isBuffer(stream)) return stream.toString("utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

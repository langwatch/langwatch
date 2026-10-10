/**
 * @vitest-environment node
 * The Group Queue's durable tier over the object-storage member on an Azure-only install: a
 * local blob fake holds the bytes under shared-key auth, as the emulator does.
 */
import { createServer, type Server } from "node:http";
import type { Readable } from "node:stream";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { groupQueueStorage } from "../group-queue-storage.ts";
import { buildObjectStorage } from "../object-storage-member.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const accountKey = Buffer.from("an account key of some length").toString("base64");
const key = "group-queue/project-1/hash-1";

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("given the durable blob tier resolves an azure destination and no S3 is configured", () => {
  let server: Server;
  let blobs: Map<string, Buffer>;
  let endpoint: string;

  beforeEach(async () => {
    blobs = new Map();
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const path = request.url ?? "";
        if (request.method === "PUT") {
          blobs.set(path, Buffer.concat(chunks));
          response.statusCode = 201;
        } else {
          const held = blobs.get(path);
          response.statusCode = held ? 200 : 404;
          if (held) response.write(held);
        }
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port was bound.");
    endpoint = `http://127.0.0.1:${address.port}/devstoreaccount1`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  describe("when an oversized envelope is offloaded and later read back", () => {
    /** @scenario "The groupQueue durable blob tier works on an Azure-only install" */
    it("round-trips the bytes through Azure Blob at main's azure-blob uri", async () => {
      const storage = buildObjectStorage({
        config: {
          backend: "azure",
          azure: { accountName: "devstoreaccount1", container: "objects", endpoint, accountKey },
        },
        clock,
        directory,
      }).value;
      const tier = groupQueueStorage({ storage });
      const envelope = Buffer.alloc(300 * 1024, 7);

      const destination = await tier.resolveDestination("project-1");
      const uri = tier.mintUri({ destination, tenantId: "project-1", key });
      await tier.objectStoreFor("project-1").put(uri, envelope, "application/gzip");

      expect(uri).toBe(`azure-blob://devstoreaccount1/objects/${key}`);
      expect(blobs.get(`/devstoreaccount1/objects/${key}`)?.equals(envelope)).toBe(true);
      const read = await bytesOf(await tier.objectStoreFor("project-1").get(uri));
      expect(read.equals(envelope)).toBe(true);
      await expect(
        tier.objectStoreFor("project-1").get(`azure-blob://devstoreaccount1/objects/absent`),
      ).rejects.toMatchObject({ name: "StoredObjectNotFoundError" });
    });
  });
});

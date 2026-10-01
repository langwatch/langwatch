/**
 * @vitest-environment node
 * An installation that selects Azure Blob and configures no S3 bucket: every
 * workload that shares the object-storage member round-trips through Azure.
 */
import { createServer, type Server } from "node:http";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UnreachableStorageLocationError } from "../object-storage-backend.ts";
import { buildObjectStorage } from "../object-storage-member.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const accountKey = Buffer.from("an account key of some length").toString("base64");

async function* body(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe("given Azure Blob is the selected provider and no S3 bucket is configured", () => {
  let server: Server;
  let blobs: Map<string, Buffer>;
  let requests: string[];
  let endpoint: string;

  beforeEach(async () => {
    blobs = new Map();
    requests = [];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const path = request.url ?? "";
        requests.push(`${request.method} ${path}`);
        if (request.method === "PUT") {
          blobs.set(path, Buffer.concat(chunks));
          response.statusCode = 201;
        } else if (request.method === "GET") {
          const held = blobs.get(path);
          response.statusCode = held ? 200 : 404;
          if (held) response.write(held);
        } else if (request.method === "DELETE") {
          response.statusCode = blobs.delete(path) ? 202 : 404;
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

  const azureOnly = () =>
    buildObjectStorage({
      config: {
        backend: "azure",
        azure: { accountName: "devstoreaccount1", accountKey, container: "objects", endpoint },
      },
      clock,
      directory,
    }).value;

  describe("when stored objects and dataset chunks are written and read back", () => {
    /** @scenario "An Azure-only installation supports every shared object-storage workload" */
    /** @scenario "Datasets round-trip through Azure Blob when azure is the configured backend" */
    it("round-trips every one through the Azure container", async () => {
      const storage = azureOnly();
      const rows = `${JSON.stringify({ a: 1 })}\n${JSON.stringify({ a: 2 })}\n`;
      const workloads = [
        { projectId: "project-1", key: "project-1/object-1", text: "media bytes" },
        {
          projectId: "project-1",
          key: "datasets/project-1/dataset-1/chunk-00000.jsonl",
          text: rows,
        },
      ];

      await expect(storage.destination("project-1")).resolves.toEqual({
        kind: "azure",
        accountName: "devstoreaccount1",
        container: "objects",
      });
      for (const workload of workloads) {
        await storage.write(workload, body(workload.text), {
          byteLength: Buffer.byteLength(workload.text),
          contentType: "application/octet-stream",
        });
        await expect(textOf(await storage.read(workload))).resolves.toBe(workload.text);
      }
      expect([...blobs.keys()]).toEqual(
        workloads.map((workload) => `/devstoreaccount1/objects/${workload.key}`),
      );
    });
  });

  describe("when an object recorded under an S3 bucket is read", () => {
    /** @scenario "The legacy S3 client factory refuses an azure destination instead of inventing a bucket" */
    it("refuses by the location's kind instead of reaching for a bucket", async () => {
      const storage = azureOnly();

      await expect(
        storage.read({
          projectId: "project-1",
          key: "project-1/object-1",
          location: { kind: "s3", bucket: "langwatch" },
        }),
      ).rejects.toMatchObject({
        name: UnreachableStorageLocationError.name,
        locationKind: "s3",
      });
      expect(requests).toEqual([]);
    });
  });
});

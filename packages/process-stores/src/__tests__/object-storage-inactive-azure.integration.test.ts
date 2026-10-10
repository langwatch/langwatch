/**
 * @see specs/migration/object-storage-provider-migration.feature
 * @see specs/features/scenarios/externalize-event-byte-content.feature
 */
import { createServer, type Server } from "node:http";

import { Temporal } from "@langwatch/time";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildObjectStorage } from "../object-storage-member.ts";
import {
  azureBlock,
  completeAzure,
  noObjectStorage,
  openObjectStorage,
} from "./object-storage-stores.fixture.ts";

/** What each bucket holds, keyed `bucket/key`: a scripted S3 over HTTP the real clients reach. */
const held = new Map<string, Buffer>();
let server: Server;
let endpoint: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const slot = decodeURIComponent((request.url ?? "").split("?")[0]!.slice(1));
      if (request.method === "PUT") {
        held.set(slot, Buffer.concat(chunks));
        response.statusCode = 200;
        response.end();
        return;
      }
      const stored = held.get(slot);
      response.statusCode = stored ? 200 : 404;
      response.end(request.method === "GET" ? stored : undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port was bound.");
  endpoint = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const credentials = { accessKeyId: "content-marker", secretAccessKey: "content-marker" };
const account = { region: "eu-west-1", credentials, forcePathStyle: true };
const incompleteAzure = azureBlock({ authMode: "sharedKey" });

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  held.clear();
  for (const close of closers.splice(0)) await close();
});

async function* body(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

async function roundTrip(options: {
  storage: {
    write: (
      at: { projectId: string; key: string },
      body: AsyncIterable<Uint8Array>,
      facts: { byteLength: number; contentType: string },
    ) => Promise<unknown>;
    read: (at: { projectId: string; key: string }) => Promise<AsyncIterable<Uint8Array>>;
  };
  projectId: string;
}) {
  const at = { projectId: options.projectId, key: `${options.projectId}/object-1` };
  await options.storage.write(at, body("payload"), { byteLength: 7, contentType: "text/plain" });
  return textOf(await options.storage.read(at));
}

describe("given incomplete Azure settings left in the deployment", () => {
  describe("when a global-S3 project stores and reads an object", () => {
    /** @scenario "An invalid inactive Azure configuration does not block S3 traffic" */
    /** @scenario "For a project without per-project storage configured, mintStorageUri falls back to the global S3_BUCKET_NAME" */
    it("round-trips it through the global bucket without an inactive-Azure error", async () => {
      const opened = await openObjectStorage({
        settings: {
          ...noObjectStorage,
          backend: "s3",
          s3: { bucket: "global-bucket", endpoint, region: "eu-west-1" },
          azure: { ...completeAzure, authMode: "sharedKey" },
        },
        environment: {
          S3_ACCESS_KEY_ID: credentials.accessKeyId,
          S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        },
      });
      closers.push(opened.close);

      expect(await roundTrip({ storage: opened.storage, projectId: "global-project" })).toBe(
        "payload",
      );
      expect([...held.keys()]).toEqual(["global-bucket/global-project/object-1"]);
    });
  });

  describe("when a private-bucket project stores and reads an object while Azure is the selected backend", () => {
    /** @scenario "An invalid inactive Azure configuration does not block S3 traffic" */
    /** @scenario "For a project with a per-project private dataplane bucket, mintStorageUri uses the project bucket, not the global one" */
    it("round-trips it through the tenant's own bucket, never touching the invalid Azure block", async () => {
      const storage = buildObjectStorage({
        config: {
          backend: "azure",
          azure: incompleteAzure,
          privateAccounts: [
            { ...account, endpoint, bucket: "dataplane-acme", organizationId: "organization-1" },
          ],
        },
        clock,
        directory,
      });

      expect(await roundTrip({ storage: storage.value, projectId: "private-project" })).toBe(
        "payload",
      );
      expect([...held.keys()]).toEqual(["dataplane-acme/private-project/object-1"]);
      await storage.close?.();
    });
  });

  describe("when a project without a private account needs the incomplete Azure block", () => {
    it("refuses that project by name instead of falling back to another backend", async () => {
      const storage = buildObjectStorage({
        config: { backend: "azure", azure: incompleteAzure, privateAccounts: [] },
        clock,
        directory,
      });

      await expect(
        roundTrip({ storage: storage.value, projectId: "platform-project" }),
      ).rejects.toMatchObject({
        name: "AzureBackendMisconfiguredError",
      });
      await storage.close?.();
    });
  });
});

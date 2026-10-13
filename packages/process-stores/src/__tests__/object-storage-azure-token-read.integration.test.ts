/**
 * @vitest-environment node
 * Objects written under the account key stay readable once the deployment moves to a token
 * mode: a local blob fake holds the bytes, and the identity SDK's token exchange is faked.
 */
import { createServer, type Server } from "node:http";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: class {
    getToken = () =>
      Promise.resolve({ token: "token-1", expiresOnTimestamp: Date.parse("2026-09-25T12:00:00Z") });
  },
  WorkloadIdentityCredential: class {},
  AzureCliCredential: class {},
}));

import { buildObjectStorage } from "../object-storage-member.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const accountKey = Buffer.from("an account key of some length").toString("base64");
const object = { projectId: "project-1", key: "project-1/object-1" };

async function* body(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe("given objects were written to Azure Blob under shared-key auth", () => {
  let server: Server;
  let blobs: Map<string, Buffer>;
  let authorizations: string[];
  let endpoint: string;

  beforeEach(async () => {
    blobs = new Map();
    authorizations = [];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const path = request.url ?? "";
        authorizations.push(`${request.method} ${request.headers.authorization ?? ""}`);
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

  describe("when the deployment moves to a token-based mode and reads them back", () => {
    /** @scenario "Reads of previously persisted azure-blob URIs succeed in a token-based mode" */
    it("resolves the recorded location through the Azure driver with a bearer token", async () => {
      const azure = { accountName: "devstoreaccount1", container: "objects", endpoint };
      const sharedKey = buildObjectStorage({
        config: { backend: "azure", azure: { ...azure, accountKey } },
        clock,
        directory,
      }).value;
      await sharedKey.write(object, body("media bytes"), {
        byteLength: Buffer.byteLength("media bytes"),
        contentType: "application/octet-stream",
      });

      const tokenMode = buildObjectStorage({
        config: {
          backend: "azure",
          azure: {
            ...azure,
            authMode: "managedIdentity",
            authorityHost: "http://127.0.0.1:9",
            allowInsecureTokenEndpointForTests: true,
          },
        },
        clock,
        directory,
      }).value;
      const recorded = {
        ...object,
        location: { kind: "azure", accountName: "devstoreaccount1", container: "objects" },
      } as const;

      await expect(textOf(await tokenMode.read(recorded))).resolves.toBe("media bytes");
      expect(authorizations).toEqual([
        expect.stringMatching(/^PUT SharedKey devstoreaccount1:/),
        "GET Bearer token-1",
      ]);
    });
  });
});

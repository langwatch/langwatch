import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AzureBackendMisconfiguredError,
  resolveAzureCredentials,
} from "../object-storage-azure-credentials.ts";
import { azureBackend } from "../object-storage-azure.ts";
import { StoredObjectNotFoundError } from "../object-storage-backend.ts";

const clock = { now: () => Temporal.Instant.from("2026-09-24T12:00:00Z") };
const at = { projectId: "project-1", key: "project-1/object-1" };
const accountKey = Buffer.from("an account key of some length").toString("base64");

interface Received {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

async function* text(value: string): AsyncGenerator<Uint8Array> {
  yield Buffer.from(value);
}

describe("given object storage on Azure Blob with an account key", () => {
  let server: Server;
  let received: Received[];
  let status: number;
  let endpoint: string;

  beforeEach(async () => {
    received = [];
    status = 201;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        response.statusCode = status;
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

  const backend = () =>
    azureBackend({
      credentials: resolveAzureCredentials({
        accountName: "devstoreaccount1",
        accountKey,
        container: "objects",
        endpoint,
      }),
      clock,
    });

  describe("when a module writes a body", () => {
    /** @scenario "An Azure-routed project's dataset chunks resolve to the Azure adapter" */
    it("puts one block blob with its length, type and a shared-key signature", async () => {
      const written = await backend().write(at, text("hello"), {
        byteLength: 5,
        contentType: "text/plain",
      });

      expect(written.sha256).toBe(createHash("sha256").update("hello").digest("hex"));
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        method: "PUT",
        url: `/devstoreaccount1/objects/${at.key}`,
        body: "hello",
        headers: {
          "content-length": "5",
          "content-type": "text/plain",
          "x-ms-blob-type": "BlockBlob",
          "x-ms-date": "Thu, 24 Sep 2026 12:00:00 GMT",
          "x-ms-version": "2021-12-02",
        },
      });
      expect(received[0]?.headers.authorization).toMatch(/^SharedKey devstoreaccount1:.+=$/);
    });
  });

  describe("when the object is absent", () => {
    /** @scenario "An Azure-routed project's dataset chunks resolve to the Azure adapter" */
    it("refuses the read with StoredObjectNotFoundError", async () => {
      status = 404;

      await expect(backend().read(at)).rejects.toBeInstanceOf(StoredObjectNotFoundError);
    });
  });

  describe("when an upload URL is signed", () => {
    /** @scenario "An Azure upload URL is a SAS that may only create and write the one blob" */
    it("answers a blob SAS with create and write permission", async () => {
      const signed = await backend().signUpload(at, {
        byteLength: 5,
        contentType: "text/csv",
        expiresAt: Temporal.Instant.from("2026-09-24T12:15:00Z"),
      });

      if (signed.kind !== "direct") throw new Error("Azure signs a direct upload URL.");
      const url = new URL(signed.url);
      expect(url.pathname).toBe(`/devstoreaccount1/objects/${at.key}`);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        sv: "2021-12-02",
        sr: "b",
        sp: "cw",
        se: "2026-09-24T12:15:00Z",
      });
      expect(url.searchParams.get("sig")).toBeTruthy();
      expect(signed.headers).toEqual({ "content-type": "text/csv", "x-ms-blob-type": "BlockBlob" });
      expect(received).toEqual([]);
    });
  });
});

describe("given STORED_OBJECTS_BACKEND=azure with an incomplete block", () => {
  /** @scenario "An incomplete Azure block is refused naming every missing variable" */
  it("refuses naming every missing variable at once", () => {
    const refusal = (() => {
      try {
        resolveAzureCredentials({});
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(refusal).toBeInstanceOf(AzureBackendMisconfiguredError);
    expect(refusal).toMatchObject({
      missingVariables: [
        "AZURE_BLOB_ACCOUNT_NAME",
        "AZURE_BLOB_CONTAINER",
        "AZURE_BLOB_ACCOUNT_KEY",
      ],
    });
  });

  it("refuses a token mode over plaintext outside tests", () => {
    expect(() =>
      resolveAzureCredentials({
        authMode: "managedIdentity",
        accountName: "account",
        container: "objects",
        endpoint: "http://storage.example.test",
        authorityHost: "https://login.example.test",
      }),
    ).toThrow(AzureBackendMisconfiguredError);
  });
});

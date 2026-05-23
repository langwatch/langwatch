/**
 * @vitest-environment node
 *
 * Unit tests for AzureBlobDriver. The driver talks the Azure Blob REST API
 * directly via global `fetch`, so we stub `fetch` to verify:
 *   - the URI is parsed into account/container/blob correctly
 *   - the request is signed with the SharedKey authorization header
 *   - GET/PUT/DELETE/HEAD round-trip the right HTTP shapes
 *   - 404s from Azure surface as ObjectNotFoundError on GET
 */
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AzureBlobDriver } from "../azure-blob-driver";
import { ObjectNotFoundError } from "../errors";

const ACCOUNT_NAME = "lwtestacct";
// Base64-encoded 256-bit key — arbitrary fixed value for deterministic signature tests.
const ACCOUNT_KEY = Buffer.from("01234567890123456789012345678901").toString("base64");
const CONTAINER = "stored-objects";
const BLOB_PATH = "proj-1/abc123";
const URI = `azure-blob://${ACCOUNT_NAME}/${CONTAINER}/${BLOB_PATH}`;

// We capture every fetch call here so each test asserts request shape.
let fetchSpy: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

function newDriver() {
  return new AzureBlobDriver({
    accountName: ACCOUNT_NAME,
    accountKey: ACCOUNT_KEY,
  });
}

describe("AzureBlobDriver", () => {
  describe("when registered alongside the existing drivers", () => {
    /** @scenario "Stored-objects writes do not mint azure-blob URIs in this PR" */
    it("uses an azure-blob scheme distinct from s3/file AND the registry round-trips existing azure-blob URIs through the driver", async () => {
      // Import lazily to keep the registry construction local to this test.
      const { StorageRegistry } = await import("../storage-registry");
      const { getUriScheme, mintAzureBlobUri } = await import("../uri");
      const { LocalFilesystemDriver } = await import("../local-filesystem-driver");
      const { S3Driver } = await import("../s3-driver");

      // Scheme is in the supported set and is NOT s3/file.
      const uri = mintAzureBlobUri({
        accountName: ACCOUNT_NAME,
        container: CONTAINER,
        projectId: "proj-1",
        sha256: "abc123",
      });
      const scheme = getUriScheme(uri);
      expect(scheme).toBe("azure-blob");
      expect(scheme).not.toBe("s3");
      expect(scheme).not.toBe("file");

      // The registry dispatches the URI to the Azure driver — verified by
      // the fact that the driver's fetch call is the one that runs.
      const azure = newDriver();
      const payload = Buffer.from("round-trip bytes", "utf8");

      // PUT — fetch sees an azure-blob URL.
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));
      // GET — same bytes come back.
      fetchSpy.mockResolvedValueOnce(new Response(payload, { status: 200 }));

      const registry = new StorageRegistry({
        s3: new S3Driver("proj-1"),
        file: new LocalFilesystemDriver(),
        "azure-blob": azure,
      });

      await registry.put(uri, payload, "application/octet-stream");
      const stream = await registry.get(uri);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("round-trip bytes");

      // Both PUT and GET hit the azure-blob endpoint (proves the registry
      // routed to the Azure driver and didn't sneak through S3 / file).
      const [putUrl] = fetchSpy.mock.calls[0]!;
      const [getUrl] = fetchSpy.mock.calls[1]!;
      expect(putUrl).toContain(".blob.core.windows.net");
      expect(getUrl).toContain(".blob.core.windows.net");
    });
  });

  describe("when parsing the URI", () => {
    it("rejects URIs with the wrong scheme", async () => {
      const driver = newDriver();
      await expect(driver.get("s3://bucket/key")).rejects.toThrow(/scheme/i);
    });

    it("rejects URIs without a blob path", async () => {
      const driver = newDriver();
      await expect(
        driver.get(`azure-blob://${ACCOUNT_NAME}/${CONTAINER}`),
      ).rejects.toThrow(/blob path/i);
    });
  });

  describe("when GETting a blob that exists", () => {
    it("hits the public-cloud endpoint with a SharedKey Authorization header and returns the bytes as a stream", async () => {
      const driver = newDriver();
      const body = Buffer.from("hello azure", "utf8");
      fetchSpy.mockResolvedValueOnce(
        new Response(body, { status: 200 }),
      );

      const stream = await driver.get(URI);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      // Public-cloud endpoint shape — account name in the host position,
      // container + blob path concatenated with single slashes.
      expect(url).toBe(
        `https://${ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER}/${BLOB_PATH}`,
      );
      expect(init.method).toBe("GET");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(
        new RegExp(`^SharedKey ${ACCOUNT_NAME}:`),
      );
      expect(headers["x-ms-date"]).toBeDefined();
      expect(headers["x-ms-version"]).toBe("2021-12-02");

      // Stream surfaces the body unchanged.
      const chunks: Buffer[] = [];
      for await (const chunk of stream as Readable) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).toString("utf8")).toBe("hello azure");
    });
  });

  describe("when GETting a blob that does not exist", () => {
    it("surfaces a 404 as ObjectNotFoundError so the read path can degrade gracefully", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }));

      await expect(driver.get(URI)).rejects.toBeInstanceOf(ObjectNotFoundError);
    });
  });

  describe("when GETting and the Azure endpoint 500s", () => {
    it("throws an error that names the URI and the status, NOT a not-found", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("oops", { status: 503 }));

      await expect(driver.get(URI)).rejects.toThrow(/503/);
      await expect(driver.get(URI)).rejects.not.toBeInstanceOf(ObjectNotFoundError);
    });
  });

  describe("when PUTting bytes for the first time", () => {
    it("sends a PUT with the BlockBlob header, content type, and signed authorization", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));

      const bytes = Buffer.from("payload", "utf8");
      await driver.put(URI, bytes, "image/png");

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(
        `https://${ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER}/${BLOB_PATH}`,
      );
      expect(init.method).toBe("PUT");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-ms-blob-type"]).toBe("BlockBlob");
      expect(headers["Content-Type"]).toBe("image/png");
      expect(headers["Content-Length"]).toBe(String(bytes.length));
      expect(headers.Authorization).toMatch(
        new RegExp(`^SharedKey ${ACCOUNT_NAME}:`),
      );
      // The body is the raw bytes, not a JSON envelope.
      expect(init.body).toBeInstanceOf(Uint8Array);
    });

    it("throws a descriptive error when Azure rejects the PUT", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(
        new Response("AuthenticationFailed", { status: 403, statusText: "Forbidden" }),
      );

      await expect(
        driver.put(URI, Buffer.from("x"), "application/octet-stream"),
      ).rejects.toThrow(/403/);
    });
  });

  describe("when DELETEing an existing blob", () => {
    it("sends a DELETE with a signed Authorization header", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 202 }));

      await driver.delete(URI);

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(init.method).toBe("DELETE");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(
        new RegExp(`^SharedKey ${ACCOUNT_NAME}:`),
      );
    });

    it("treats a 404 as success because delete is idempotent", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }));

      await expect(driver.delete(URI)).resolves.toBeUndefined();
    });
  });

  describe("when checking existence", () => {
    it("returns true on 200", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));
      expect(await driver.exists(URI)).toBe(true);
    });

    it("returns false on 404 without throwing", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 404 }));
      expect(await driver.exists(URI)).toBe(false);
    });

    it("throws on a non-404 error", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 503 }));
      await expect(driver.exists(URI)).rejects.toThrow(/503/);
    });
  });

  describe("given a fixed-input vector (known-answer test for SharedKey HMAC)", () => {
    /**
     * KAT vector — all inputs are fixed so any regression in canonicalization
     * order, positional string-to-sign slots, or HMAC construction fails this
     * test deterministically rather than silently producing a header that passes
     * a prefix regex but Azure rejects with a 403.
     *
     * Canonical string-to-sign (14 newline-separated fields):
     *   PUT\n
     *   \n                                    ← Content-Encoding (empty)
     *   \n                                    ← Content-Language (empty)
     *   11\n                                  ← Content-Length
     *   \n                                    ← Content-MD5 (empty)
     *   application/octet-stream\n            ← Content-Type
     *   \n                                    ← Date legacy (empty)
     *   \n                                    ← If-Modified-Since (empty)
     *   \n                                    ← If-Match (empty)
     *   \n                                    ← If-None-Match (empty)
     *   \n                                    ← If-Unmodified-Since (empty)
     *   \n                                    ← Range (empty)
     *   x-ms-blob-type:BlockBlob\n            ← canonicalized headers (sorted)
     *   x-ms-date:Wed, 23 Oct 2013 09:49:06 GMT\n
     *   x-ms-version:2021-12-02\n
     *   /myaccount/stored-objects/proj-1/kat-blob  ← canonicalized resource
     *
     * HMAC-SHA256 of the above string with key
     *   Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
     * (before base64-encoding the key) produces the expected signature below.
     *
     * To reproduce independently:
     *   node -e "
     *     const c=require('crypto');
     *     const key=Buffer.from('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZg==','base64');
     *     const sts='PUT\n\n\n11\n\napplication/octet-stream\n\n\n\n\n\n\nx-ms-blob-type:BlockBlob\nx-ms-date:Wed, 23 Oct 2013 09:49:06 GMT\nx-ms-version:2021-12-02\n/myaccount/stored-objects/proj-1/kat-blob';
     *     console.log(c.createHmac('sha256',key).update(sts,'utf8').digest('base64'));
     *   "
     */
    const KAT_ACCOUNT_NAME = "myaccount";
    // Raw bytes: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" (64 ASCII chars)
    const KAT_ACCOUNT_KEY = Buffer.from(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ).toString("base64");
    const KAT_CONTAINER = "stored-objects";
    const KAT_BLOB_PATH = "proj-1/kat-blob";
    const KAT_URI = `azure-blob://${KAT_ACCOUNT_NAME}/${KAT_CONTAINER}/${KAT_BLOB_PATH}`;
    const KAT_TIMESTAMP = "Wed, 23 Oct 2013 09:49:06 GMT";
    const KAT_BODY = Buffer.from("hello world"); // 11 bytes

    // Offline-computed expected signature (see derivation above).
    const KAT_EXPECTED_AUTH =
      "SharedKey myaccount:cLBL2cZBVlJlZk1g7S4IahPge8ljBVvWYqomzG4ZZQ8=";

    it("produces the exact SharedKey Authorization header for fixed inputs", async () => {
      // Fix Date so the driver's `new Date().toUTCString()` returns the
      // deterministic timestamp baked into the KAT vector above.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(KAT_TIMESTAMP));

      const driver = new AzureBlobDriver({
        accountName: KAT_ACCOUNT_NAME,
        accountKey: KAT_ACCOUNT_KEY,
      });

      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));
      await driver.put(KAT_URI, KAT_BODY, "application/octet-stream");

      vi.useRealTimers();

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(KAT_EXPECTED_AUTH);
    });

    it("recomputes the same signature when the same inputs are fed to the raw HMAC", () => {
      // This sub-test validates the KAT vector itself is self-consistent —
      // the expected value is not a magic constant but matches inline crypto.
      const stringToSign = [
        "PUT",
        "",
        "",
        String(KAT_BODY.length),
        "",
        "application/octet-stream",
        "",
        "",
        "",
        "",
        "",
        "",
        [
          `x-ms-blob-type:BlockBlob`,
          `x-ms-date:${KAT_TIMESTAMP}`,
          `x-ms-version:2021-12-02`,
        ].join("\n"),
        `/${KAT_ACCOUNT_NAME}/${KAT_CONTAINER}/${KAT_BLOB_PATH}`,
      ].join("\n");

      const keyBytes = Buffer.from(KAT_ACCOUNT_KEY, "base64");
      const signature = crypto
        .createHmac("sha256", keyBytes)
        .update(stringToSign, "utf8")
        .digest("base64");

      expect(`SharedKey ${KAT_ACCOUNT_NAME}:${signature}`).toBe(KAT_EXPECTED_AUTH);
    });
  });

  describe("when an alternate endpoint is configured (e.g. Azurite emulator)", () => {
    it("uses the configured endpoint instead of the public-cloud hostname", async () => {
      const driver = new AzureBlobDriver({
        accountName: ACCOUNT_NAME,
        accountKey: ACCOUNT_KEY,
        endpointBaseUrl: "http://127.0.0.1:10000/devstoreaccount1",
      });
      fetchSpy.mockResolvedValueOnce(new Response("emulator", { status: 200 }));

      await driver.get(URI);

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(
        `http://127.0.0.1:10000/devstoreaccount1/${CONTAINER}/${BLOB_PATH}`,
      );
    });
  });
});

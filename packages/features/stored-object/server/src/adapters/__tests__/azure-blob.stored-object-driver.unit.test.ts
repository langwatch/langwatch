/**
 * @vitest-environment node
 *
 * Unit tests for AzureBlobStoredObjectDriver. The driver talks the Azure
 * Blob REST API directly via global `fetch`, so we stub `fetch` to verify:
 *   - the URI is parsed into account/container/blob correctly
 *   - the request is signed with the SharedKey authorization header
 *   - GET/PUT/DELETE/HEAD round-trip the right HTTP shapes
 *   - 404s from Azure surface as ObjectNotFoundError on GET
 */
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStoredObjectStorageScheme,
  mintAzureBlobStoredObjectUri,
} from "@langwatch/stored-object-contract";

// Token-mode tests isolate the driver from real @azure/identity network
// calls — token acquisition itself is covered by
// azure-blob-token-provider.unit.test.ts. Here we only assert the driver
// calls the provider correctly and reacts to its result / to 401 / 403
// responses.
const getAzureBlobTokenMock = vi.fn();
const invalidateAzureBlobTokenMock = vi.fn();
vi.mock("../azure-blob-token-provider", () => ({
  getAzureBlobToken: (...args: unknown[]) => getAzureBlobTokenMock(...args),
  invalidateAzureBlobToken: (...args: unknown[]) =>
    invalidateAzureBlobTokenMock(...args),
}));

import { AzureBlobStoredObjectDriver } from "../azure-blob.stored-object-driver.adapter";
import { StoredObjectStorageRegistry } from "../stored-object-storage.registry";
import type { StoredObjectStorageDriver } from "../stored-object-storage.registry";
import { ObjectNotFoundError } from "../../errors";

const ACCOUNT_NAME = "lwtestacct";
// Base64-encoded 256-bit key — arbitrary fixed value for deterministic signature tests.
const ACCOUNT_KEY = Buffer.from("01234567890123456789012345678901").toString(
  "base64",
);
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
  getAzureBlobTokenMock.mockReset();
  invalidateAzureBlobTokenMock.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

function newDriver() {
  return AzureBlobStoredObjectDriver.create({
    mode: "sharedKey",
    accountName: ACCOUNT_NAME,
    accountKey: ACCOUNT_KEY,
  });
}

function newTokenModeDriver(
  mode:
    | "workloadIdentity"
    | "managedIdentity"
    | "azureCli" = "workloadIdentity",
) {
  return AzureBlobStoredObjectDriver.create({
    mode,
    accountName: ACCOUNT_NAME,
    identity: {},
  });
}

/** A minimal stub for the non-Azure registry slots — routing is what these tests assert, never exercised otherwise. */
class NeverCalledDriver implements StoredObjectStorageDriver {
  get(): Promise<Readable> {
    throw new Error("not expected to be called in this suite");
  }
  put(): Promise<void> {
    throw new Error("not expected to be called in this suite");
  }
  delete(): Promise<void> {
    throw new Error("not expected to be called in this suite");
  }
  exists(): Promise<boolean> {
    throw new Error("not expected to be called in this suite");
  }
}

describe("AzureBlobStoredObjectDriver", () => {
  // Restored in a hook, never inline: a rejected assertion between
  // useFakeTimers() and an inline restore would leave every subsequent test
  // in this file on a frozen clock, failing somewhere unrelated.
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when registered alongside the existing drivers", () => {
    /** @scenario "Both drivers remain available for reads regardless of which scheme new URIs use" */
    it("uses an azure-blob scheme distinct from s3/file AND the registry round-trips existing azure-blob URIs through the driver", async () => {
      // Scheme is in the supported set and is NOT s3/file.
      const uri = mintAzureBlobStoredObjectUri({
        accountName: ACCOUNT_NAME,
        container: CONTAINER,
        projectId: "proj-1",
        sha256: "abc123",
      });
      const scheme = getStoredObjectStorageScheme(uri);
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

      const registry = new StoredObjectStorageRegistry({
        s3: new NeverCalledDriver(),
        file: new NeverCalledDriver(),
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
      fetchSpy.mockResolvedValueOnce(new Response(body, { status: 200 }));

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
      await expect(driver.get(URI)).rejects.not.toBeInstanceOf(
        ObjectNotFoundError,
      );
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
      // Content-Length must NOT be set manually: undici computes it from the
      // body and rejects a user-supplied duplicate (InvalidArgumentError).
      // The SharedKey signature still covers the byte length, which matches
      // what undici puts on the wire.
      expect(headers["Content-Length"]).toBeUndefined();
      expect(headers.Authorization).toMatch(
        new RegExp(`^SharedKey ${ACCOUNT_NAME}:`),
      );
      // The body is the raw bytes, not a JSON envelope.
      expect(init.body).toBeInstanceOf(Uint8Array);
    });

    it("throws a descriptive error when Azure rejects the PUT", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(
        new Response("AuthenticationFailed", {
          status: 403,
          statusText: "Forbidden",
        }),
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

  describe("ensureContainer() — integration-test setup helper, not part of the storage driver port", () => {
    it("PUTs ?restype=container with the query param folded into the signed resource", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));

      await driver.ensureContainer(CONTAINER);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(
        `https://${ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER}?restype=container`,
      );
      expect(init.method).toBe("PUT");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(
        new RegExp(`^SharedKey ${ACCOUNT_NAME}:`),
      );
    });

    it("treats 409 (already exists) as success — idempotent", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(
        new Response("ContainerAlreadyExists", { status: 409 }),
      );

      await expect(driver.ensureContainer(CONTAINER)).resolves.toBeUndefined();
    });

    it("throws on a non-409 error", async () => {
      const driver = newDriver();
      fetchSpy.mockResolvedValueOnce(new Response("oops", { status: 500 }));

      await expect(driver.ensureContainer(CONTAINER)).rejects.toThrow(/500/);
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

      const driver = AzureBlobStoredObjectDriver.create({
        mode: "sharedKey",
        accountName: KAT_ACCOUNT_NAME,
        accountKey: KAT_ACCOUNT_KEY,
      });

      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));
      await driver.put(KAT_URI, KAT_BODY, "application/octet-stream");

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

      expect(`SharedKey ${KAT_ACCOUNT_NAME}:${signature}`).toBe(
        KAT_EXPECTED_AUTH,
      );
    });
  });

  describe("when an alternate endpoint is configured (e.g. Azurite emulator)", () => {
    it("uses the configured endpoint instead of the public-cloud hostname", async () => {
      const driver = AzureBlobStoredObjectDriver.create({
        mode: "sharedKey",
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

  describe("when Azurite path-style addressing puts the account in the endpoint path", () => {
    /**
     * Regression for the Azurite-signing gap (AC37 / issue #4133): when
     * `endpointBaseUrl` addresses the account via a path segment (Azurite's
     * only mode — it has no per-account subdomain like production Azure),
     * the shared-key canonicalised resource must include the account name
     * TWICE (`/{account}/{account}/{container}/{blob}`), not once. Getting
     * this wrong produces a well-formed-looking `SharedKey` header that
     * Azurite rejects with 403 AuthenticationFailed — a bug a prefix-only
     * regex assertion on the header would never catch, so this test
     * recomputes the exact expected signature (KAT-style) rather than just
     * checking the `SharedKey {account}:` prefix.
     */
    const PATH_STYLE_ACCOUNT = "devstoreaccount1";
    const PATH_STYLE_ENDPOINT = "http://127.0.0.1:10000/devstoreaccount1";
    const PATH_STYLE_TIMESTAMP = "Wed, 23 Oct 2013 09:49:06 GMT";
    const PATH_STYLE_BODY = Buffer.from("hello world"); // 11 bytes

    it("signs with the account name doubled in the canonicalised resource", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(PATH_STYLE_TIMESTAMP));

      const driver = AzureBlobStoredObjectDriver.create({
        mode: "sharedKey",
        accountName: PATH_STYLE_ACCOUNT,
        accountKey: ACCOUNT_KEY,
        endpointBaseUrl: PATH_STYLE_ENDPOINT,
      });
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));

      const uri = `azure-blob://${PATH_STYLE_ACCOUNT}/${CONTAINER}/${BLOB_PATH}`;
      await driver.put(uri, PATH_STYLE_BODY, "application/octet-stream");

      const stringToSign = [
        "PUT",
        "",
        "",
        String(PATH_STYLE_BODY.length),
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
          `x-ms-date:${PATH_STYLE_TIMESTAMP}`,
          `x-ms-version:2021-12-02`,
        ].join("\n"),
        // The account name appears twice: once for "the path-style host",
        // once for "the actual account" — this is the assertion under test.
        `/${PATH_STYLE_ACCOUNT}/${PATH_STYLE_ACCOUNT}/${CONTAINER}/${BLOB_PATH}`,
      ].join("\n");
      const keyBytes = Buffer.from(ACCOUNT_KEY, "base64");
      const expectedSignature = crypto
        .createHmac("sha256", keyBytes)
        .update(stringToSign, "utf8")
        .digest("base64");

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        `SharedKey ${PATH_STYLE_ACCOUNT}:${expectedSignature}`,
      );
    });

    it("does NOT use the single-account-segment signature production Azure would produce", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(PATH_STYLE_TIMESTAMP));

      const driver = AzureBlobStoredObjectDriver.create({
        mode: "sharedKey",
        accountName: PATH_STYLE_ACCOUNT,
        accountKey: ACCOUNT_KEY,
        endpointBaseUrl: PATH_STYLE_ENDPOINT,
      });
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));

      const uri = `azure-blob://${PATH_STYLE_ACCOUNT}/${CONTAINER}/${BLOB_PATH}`;
      await driver.put(uri, PATH_STYLE_BODY, "application/octet-stream");

      const wrongStringToSign = [
        "PUT",
        "",
        "",
        String(PATH_STYLE_BODY.length),
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
          `x-ms-date:${PATH_STYLE_TIMESTAMP}`,
          `x-ms-version:2021-12-02`,
        ].join("\n"),
        `/${PATH_STYLE_ACCOUNT}/${CONTAINER}/${BLOB_PATH}`,
      ].join("\n");
      const keyBytes = Buffer.from(ACCOUNT_KEY, "base64");
      const wrongSignature = crypto
        .createHmac("sha256", keyBytes)
        .update(wrongStringToSign, "utf8")
        .digest("base64");

      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).not.toBe(
        `SharedKey ${PATH_STYLE_ACCOUNT}:${wrongSignature}`,
      );
    });
  });

  describe("given a token-based auth mode with a valid access token", () => {
    beforeEach(() => {
      getAzureBlobTokenMock.mockResolvedValue("bearer-token-value");
    });

    /** @scenario "Every Azure Blob operation carries a bearer token in a token-based mode" */
    it.each([
      ["get" as const, () => driverGet(), 200],
      ["put" as const, () => driverPut(), 201],
      ["delete" as const, () => driverDelete(), 202],
      ["exists" as const, () => driverExists(), 200],
      ["head" as const, () => driverHead(), 200],
      ["ensureContainer" as const, () => driverEnsureContainer(), 201],
    ])("%s carries a Bearer Authorization header, no SharedKey signature, and a supported storage API version", async (_op, run, status) => {
      fetchSpy.mockResolvedValueOnce(
        new Response(status === 200 ? "body" : "", {
          status,
          headers: status === 200 ? { "content-length": "4" } : undefined,
        }),
      );

      await run();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [, init] = fetchSpy.mock.calls[0]!;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer bearer-token-value");
      expect(headers.Authorization).not.toMatch(/^SharedKey/);
      expect(headers["x-ms-version"]).toBe("2021-12-02");
    });

    function driverGet() {
      return newTokenModeDriver().get(URI);
    }
    function driverPut() {
      return newTokenModeDriver().put(
        URI,
        Buffer.from("x"),
        "application/octet-stream",
      );
    }
    function driverDelete() {
      return newTokenModeDriver().delete(URI);
    }
    function driverExists() {
      return newTokenModeDriver().exists(URI);
    }
    function driverHead() {
      return newTokenModeDriver().head(URI);
    }
    function driverEnsureContainer() {
      return newTokenModeDriver().ensureContainer(CONTAINER);
    }
  });

  /**
   * The headline contract of issue #6087 is that there is NO credential
   * fallback: a token-mode driver that cannot get a token must fail, never
   * quietly downgrade to shared-key or send the request unsigned. Every other
   * token test here stubs a SUCCESSFUL acquisition, so adding a `catch` around
   * the token call that fell back to shared-key signing would leave this whole
   * suite green. These pin the failure path itself.
   */
  describe("given a token-based auth mode where the token exchange fails", () => {
    const tokenFailure = new Error(
      "AADSTS70021: No matching federated identity record found",
    );

    beforeEach(() => {
      getAzureBlobTokenMock.mockRejectedValue(tokenFailure);
    });

    /** @scenario "A failed token exchange surfaces as a configuration error, not a storage error" */
    it.each([
      ["get" as const, () => newTokenModeDriver().get(URI)],
      [
        "put" as const,
        () =>
          newTokenModeDriver().put(
            URI,
            Buffer.from("x"),
            "application/octet-stream",
          ),
      ],
      ["delete" as const, () => newTokenModeDriver().delete(URI)],
      ["exists" as const, () => newTokenModeDriver().exists(URI)],
      ["head" as const, () => newTokenModeDriver().head(URI)],
    ])("%s rejects without ever reaching the network or building a shared-key signature", async (_op, run) => {
      await expect(run()).rejects.toThrow(tokenFailure);

      // No fallback: nothing was sent at all, signed or unsigned.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("never constructs a SharedKey Authorization header as a fallback", async () => {
      await expect(newTokenModeDriver().get(URI)).rejects.toThrow();

      const sentAuthorizations = fetchSpy.mock.calls.map(
        ([, init]) =>
          (init?.headers as Record<string, string> | undefined)?.Authorization,
      );
      expect(sentAuthorizations).toHaveLength(0);
      expect(sentAuthorizations.some((a) => a?.startsWith("SharedKey"))).toBe(
        false,
      );
    });
  });

  describe("given a token-based auth mode signing the same operation against different endpoint addressing styles", () => {
    /** @scenario "Bearer authorization is identical regardless of endpoint addressing style" */
    it("produces the same Authorization header for a host-style and a path-style endpoint, neither carrying a SharedKey signature", async () => {
      getAzureBlobTokenMock.mockResolvedValue("same-bearer-token");

      const hostStyleDriver = AzureBlobStoredObjectDriver.create({
        mode: "workloadIdentity",
        accountName: ACCOUNT_NAME,
        identity: {},
      });
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));
      await hostStyleDriver.put(
        URI,
        Buffer.from("x"),
        "application/octet-stream",
      );
      const hostHeaders = fetchSpy.mock.calls[0]![1].headers as Record<
        string,
        string
      >;

      const pathStyleDriver = AzureBlobStoredObjectDriver.create({
        mode: "workloadIdentity",
        accountName: ACCOUNT_NAME,
        identity: {},
        endpointBaseUrl: "http://127.0.0.1:10000/devstoreaccount1",
      });
      fetchSpy.mockResolvedValueOnce(new Response("", { status: 201 }));
      await pathStyleDriver.put(
        URI,
        Buffer.from("x"),
        "application/octet-stream",
      );
      const pathHeaders = fetchSpy.mock.calls[1]![1].headers as Record<
        string,
        string
      >;

      expect(hostHeaders.Authorization).toBe("Bearer same-bearer-token");
      expect(pathHeaders.Authorization).toBe("Bearer same-bearer-token");
      expect(hostHeaders.Authorization).not.toMatch(/^SharedKey/);
      expect(pathHeaders.Authorization).not.toMatch(/^SharedKey/);
    });
  });

  describe("given a storage request is rejected as unauthenticated (401) despite a cached token", () => {
    /** @scenario "An expired-token rejection is retried exactly once with a fresh token" */
    it("invalidates the cached token and retries the request exactly once", async () => {
      getAzureBlobTokenMock
        .mockResolvedValueOnce("expired-token")
        .mockResolvedValueOnce("fresh-token");
      fetchSpy
        .mockResolvedValueOnce(new Response("", { status: 401 }))
        .mockResolvedValueOnce(new Response("", { status: 200 }));

      const exists = await newTokenModeDriver().exists(URI);

      expect(exists).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(invalidateAzureBlobTokenMock).toHaveBeenCalledOnce();
      const [, retryInit] = fetchSpy.mock.calls[1]!;
      expect((retryInit.headers as Record<string, string>).Authorization).toBe(
        "Bearer fresh-token",
      );
    });

    it("propagates a second consecutive 401 rather than retrying again", async () => {
      getAzureBlobTokenMock.mockResolvedValue("still-rejected-token");
      fetchSpy
        .mockResolvedValueOnce(new Response("nope", { status: 401 }))
        .mockResolvedValueOnce(new Response("nope again", { status: 401 }));

      await expect(newTokenModeDriver().get(URI)).rejects.toThrow(/401/);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(invalidateAzureBlobTokenMock).toHaveBeenCalledOnce();
    });
  });

  describe("given a storage request is rejected because the identity lacks data permissions (403)", () => {
    /** @scenario "A permission rejection is not retried and names the missing role assignment" */
    it("does not acquire a new token or retry, and names the required role assignment and scope", async () => {
      getAzureBlobTokenMock.mockResolvedValue("token-without-permission");
      fetchSpy.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 }),
      );

      let message = "";
      try {
        await newTokenModeDriver().get(URI);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toMatch(/Storage Blob Data Contributor/);
      // The remedy names the ROLE, never the account or container: those two
      // segments are tenant-identifying and redactStorageUri strips them from
      // every other storage error. An operator does not need them echoed —
      // they are granting a role on the account they already configured.
      expect(message).not.toMatch(new RegExp(CONTAINER));
      expect(message).not.toMatch(new RegExp(ACCOUNT_NAME));
      // Exactly one fetch — no retry attempted for a 403.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(invalidateAzureBlobTokenMock).not.toHaveBeenCalled();
    });
  });

  describe("secret hygiene — any Azure Blob operation failing in any auth mode", () => {
    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("never includes the bearer token value in a thrown error message", async () => {
      getAzureBlobTokenMock.mockResolvedValue("super-secret-bearer-token");
      fetchSpy.mockResolvedValueOnce(
        new Response("denied", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      let message = "";
      try {
        await newTokenModeDriver().get(URI);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/super-secret-bearer-token/);
    });

    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("never includes the SharedKey account key or signature value in a thrown error message", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response("denied", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      let message = "";
      try {
        await newDriver().get(URI);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain(ACCOUNT_KEY);
      expect(message).not.toMatch(/SharedKey/);
    });

    /** @scenario "Authorization material never reaches logs, errors, or traces" */
    it("redacts storage URIs embedded in a failing response body via redactStorageUrisInText", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          `blocked by policy for azure-blob://${ACCOUNT_NAME}/${CONTAINER}/${BLOB_PATH}`,
          {
            status: 500,
            statusText: "Internal Server Error",
          },
        ),
      );

      let message = "";
      try {
        await newDriver().put(
          URI,
          Buffer.from("x"),
          "application/octet-stream",
        );
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toMatch(/\*\*\*/);
      expect(message).not.toMatch(
        new RegExp(`azure-blob://${ACCOUNT_NAME}/${CONTAINER}`),
      );
    });
  });
});

/**
 * AzureBlobDriver — StorageDriver implementation backed by Azure Blob Storage.
 *
 * Talks the Azure Blob REST API directly via `fetch` so no Azure SDK
 * dependency is needed at runtime. Works against the production Azure
 * cloud and against the Azurite emulator (which speaks the same REST
 * shape on a local endpoint).
 *
 * URI shape: `azure-blob://{accountName}/{container}/{key}`
 *
 * Authentication: requires `AZURE_BLOB_ACCOUNT_NAME` and
 * `AZURE_BLOB_ACCOUNT_KEY` to be set in the environment. The shared-key
 * scheme is sufficient for self-hosted deployments; production Azure
 * deployments will typically rotate to a managed identity wrapper later
 * — that change lives behind this driver, not in the stored-objects
 * service.
 *
 * Construction takes the account credentials by reference so test code
 * can inject Azurite credentials without mutating process.env.
 */
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { ObjectNotFoundError } from "./errors";
import { redactStorageUri } from "./project-storage-destination";
import type { StorageDriver } from "./storage-driver";
import { getUriScheme } from "./uri";

/**
 * Settings for talking to an Azure Blob endpoint.
 *
 * `endpointBaseUrl` defaults to `https://{accountName}.blob.core.windows.net`
 * for the public cloud. Tests against Azurite override this to point at
 * the emulator (typically `http://127.0.0.1:10000/{accountName}`).
 */
export interface AzureBlobCredentials {
  accountName: string;
  accountKey: string;
  endpointBaseUrl?: string;
}

interface ParsedAzureBlobUri {
  accountName: string;
  container: string;
  blobPath: string;
}

/** Parses `azure-blob://{accountName}/{container}/{key...}` into its parts. */
function parseAzureBlobUri(uri: string): ParsedAzureBlobUri {
  const scheme = getUriScheme(uri); // throws on non-supported schemes
  if (scheme !== "azure-blob") {
    throw new Error(
      `Invalid Azure Blob URI scheme "${scheme}" in "${uri}" — expected "azure-blob"`,
    );
  }

  const withoutScheme = uri.slice("azure-blob://".length);
  const firstSlash = withoutScheme.indexOf("/");
  if (firstSlash === -1) {
    throw new Error(`Invalid Azure Blob URI (no container): "${uri}"`);
  }
  const accountName = withoutScheme.slice(0, firstSlash);
  const rest = withoutScheme.slice(firstSlash + 1);

  const secondSlash = rest.indexOf("/");
  if (secondSlash === -1) {
    throw new Error(`Invalid Azure Blob URI (no blob path): "${uri}"`);
  }
  const container = rest.slice(0, secondSlash);
  const blobPath = rest.slice(secondSlash + 1);

  if (!accountName) {
    throw new Error(`Invalid Azure Blob URI (empty account name): "${uri}"`);
  }
  if (!container) {
    throw new Error(`Invalid Azure Blob URI (empty container): "${uri}"`);
  }
  if (!blobPath) {
    throw new Error(`Invalid Azure Blob URI (empty blob path): "${uri}"`);
  }

  return { accountName, container, blobPath };
}

/**
 * True when `endpointBaseUrl` addresses the account via a path segment
 * rather than a subdomain — the shape Azurite (and other path-style
 * emulators) use, e.g. `http://127.0.0.1:10000/devstoreaccount1` for
 * account `devstoreaccount1`. Production Azure always uses host-style
 * (`https://{account}.blob.core.windows.net`), so this only trips for an
 * explicitly-configured emulator/dev endpoint.
 */
function isPathStyleEndpoint(
  endpointBaseUrl: string | undefined,
  accountName: string,
): boolean {
  if (!endpointBaseUrl) return false;
  try {
    // Normalised first: a trailing slash leaves an empty final path segment,
    // so the account-name comparison below would never match.
    const url = new URL(normalizeEndpoint(endpointBaseUrl));
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] === accountName;
  } catch {
    return false;
  }
}

/**
 * Builds the canonicalised resource path Azure uses for the shared-key
 * authorization signature. See:
 * https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
 *
 * Path-style addressing (Azurite): the account name is ALSO the first path
 * segment of the request URL (`/{account}/{container}/{blob}`), so Azure's
 * signing spec requires it to appear twice in the canonicalised resource —
 * once for "the emulator account" and once for "the actual account" —
 * giving `/{account}/{account}/{container}/{blob}`. Host-style (production)
 * keeps the single `/{account}/{container}/{blob}` form. Getting this wrong
 * produces a well-formed-looking `SharedKey` header that Azure/Azurite
 * rejects with a 403 AuthenticationFailed — no test hits this path unless
 * it asserts the actual signed bytes, not just the header's prefix.
 */
function canonicalisedResource({
  accountName,
  container,
  blobPath,
  pathStyle,
}: {
  accountName: string;
  container: string;
  blobPath: string;
  pathStyle: boolean;
}): string {
  // A blank blobPath addresses the CONTAINER itself (e.g. container-create),
  // not a blob under it — omit the trailing "/" so the resource path reads
  // `/{account}/{container}`, not `/{account}/{container}/`.
  const resourcePath = blobPath ? `${container}/${blobPath}` : container;
  return pathStyle
    ? `/${accountName}/${accountName}/${resourcePath}`
    : `/${accountName}/${resourcePath}`;
}

/**
 * Appends canonicalised query parameters to a canonicalised resource, per the
 * shared-key spec: each param is lowercased-name, sorted, `name:value` on its
 * own line. Only used by container-level operations (e.g. `?restype=container`)
 * — the blob get/put/delete/exists paths carry no query string.
 */
function withCanonicalisedQuery(
  resource: string,
  queryParams: Record<string, string>,
): string {
  // Spec: lowercase the parameter name FIRST, then sort those names with an
  // ordinal (byte) comparison. Sorting the original key and lowercasing after
  // reorders a mixed-case param, and localeCompare is locale-sensitive — both
  // produce a signature Azure computes differently and rejects with a 403.
  const lines = Object.entries(queryParams)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`);
  return lines.length > 0 ? [resource, ...lines].join("\n") : resource;
}

/**
 * Builds the canonicalised headers block for the shared-key signature.
 * All `x-ms-*` headers are lowercased, sorted, and joined with `\n`.
 */
function canonicalisedHeaders(headers: Record<string, string>): string {
  const xMsHeaders = Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-ms-"))
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    // Ordinal, not localeCompare: the spec compares bytes, and a
    // locale-aware collation can order the same two names differently.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return xMsHeaders.map(([k, v]) => `${k}:${v}`).join("\n");
}

/**
 * Computes the shared-key authorization header per the Azure spec.
 */
function signRequest({
  method,
  contentLength,
  contentType,
  date,
  accountName,
  accountKey,
  container,
  blobPath,
  extraHeaders,
  pathStyle,
  queryParams = {},
}: {
  method: string;
  contentLength: string;
  contentType: string;
  date: string;
  accountName: string;
  accountKey: string;
  container: string;
  blobPath: string;
  extraHeaders: Record<string, string>;
  pathStyle: boolean;
  /** Canonicalised query params (e.g. `{ restype: "container" }`) for container-level operations. */
  queryParams?: Record<string, string>;
}): string {
  const xMsHeaders = {
    "x-ms-date": date,
    "x-ms-version": "2021-12-02",
    ...extraHeaders,
  };

  const stringToSign = [
    method,
    "", // Content-Encoding
    "", // Content-Language
    contentLength,
    "", // Content-MD5
    contentType,
    "", // Date (legacy)
    "", // If-Modified-Since
    "", // If-Match
    "", // If-None-Match
    "", // If-Unmodified-Since
    "", // Range
    canonicalisedHeaders(xMsHeaders),
    withCanonicalisedQuery(
      canonicalisedResource({ accountName, container, blobPath, pathStyle }),
      queryParams,
    ),
  ].join("\n");

  const keyBytes = Buffer.from(accountKey, "base64");
  const signature = crypto
    .createHmac("sha256", keyBytes)
    .update(stringToSign, "utf8")
    .digest("base64");

  return `SharedKey ${accountName}:${signature}`;
}

function defaultEndpoint(accountName: string): string {
  return `https://${accountName}.blob.core.windows.net`;
}

/**
 * Endpoints are concatenated as `${endpoint}/${container}/${blobPath}`, so a
 * trailing slash on the configured value produces `//container/blob` on the
 * wire while the signature canonicalises `/container/blob`. Azure answers 400.
 * A trailing slash is a normal thing to paste out of the portal, so strip it
 * once here rather than at each of the six call sites — path-style detection
 * reads the same normalised value, otherwise the empty last path segment
 * makes it miss the account name.
 */
function normalizeEndpoint(endpointBaseUrl: string): string {
  return endpointBaseUrl.replace(/\/+$/, "");
}

/**
 * StorageDriver for Azure Blob Storage. Talks REST directly so we
 * don't pull in the full @azure/storage-blob SDK for one driver.
 */
export class AzureBlobDriver implements StorageDriver {
  constructor(private readonly credentials: AzureBlobCredentials) {}

  async get(uri: string): Promise<Readable> {
    const { container, blobPath } = parseAzureBlobUri(uri);
    const { endpoint, headers } = this.signedRequest({
      method: "GET",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    const response = await fetch(`${endpoint}/${container}/${blobPath}`, {
      method: "GET",
      headers,
    });

    if (response.status === 404) {
      throw new ObjectNotFoundError(uri);
    }
    if (!response.ok) {
      throw new Error(
        `Azure Blob GET failed for ${redactStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error(
        `Azure Blob GET returned empty body for ${redactStorageUri(uri)}`,
      );
    }
    return Readable.fromWeb(
      response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
    );
  }

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    const { container, blobPath } = parseAzureBlobUri(uri);

    const { endpoint, headers } = this.signedRequest({
      method: "PUT",
      container,
      blobPath,
      // Per the shared-key spec (x-ms-version 2015-02-21+, and we pin
      // 2021-12-02), the Content-Length line of the string-to-sign is the
      // EMPTY STRING — not "0" — when the body is empty. Signing "0" yields
      // a well-formed SharedKey header that Azure/Azurite rejects with 403
      // AuthorizationFailure. Reachable in production: a zero-byte staged
      // dataset upload (putStaged has a max cap, no minimum).
      contentLength: bytes.length > 0 ? String(bytes.length) : "",
      contentType: mediaType,
      extraHeaders: { "x-ms-blob-type": "BlockBlob" },
    });

    // Content-Length is deliberately NOT set as a request header: undici
    // computes it from the body and rejects a manually supplied duplicate.
    // The signature above covers the value undici puts on the wire.
    const response = await fetch(`${endpoint}/${container}/${blobPath}`, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": mediaType,
      },
      body: new Uint8Array(bytes),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Azure Blob PUT failed for ${redactStorageUri(uri)}: ${response.status} ${response.statusText} ${body}`,
      );
    }
  }

  async delete(uri: string): Promise<void> {
    const { container, blobPath } = parseAzureBlobUri(uri);

    const { endpoint, headers } = this.signedRequest({
      method: "DELETE",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    const response = await fetch(`${endpoint}/${container}/${blobPath}`, {
      method: "DELETE",
      headers,
    });

    // Delete is idempotent: 404 means it was already gone, which is the
    // success condition for callers (the row is going away anyway).
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Azure Blob DELETE failed for ${redactStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }
  }

  async exists(uri: string): Promise<boolean> {
    const { container, blobPath } = parseAzureBlobUri(uri);

    const { endpoint, headers } = this.signedRequest({
      method: "HEAD",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    const response = await fetch(`${endpoint}/${container}/${blobPath}`, {
      method: "HEAD",
      headers,
    });

    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `Azure Blob HEAD failed for ${redactStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }
    return true;
  }

  /**
   * Returns the blob's size in bytes from a signed HEAD — Content-Length
   * without transferring the body. NOT part of the `StorageDriver`
   * interface; used by `AzureDatasetStorage.headStagedObjectSize` to
   * enforce the finalize size cap without downloading the staged upload.
   *
   * @throws ObjectNotFoundError when the blob does not exist.
   */
  async head(uri: string): Promise<number> {
    const { container, blobPath } = parseAzureBlobUri(uri);

    const { endpoint, headers } = this.signedRequest({
      method: "HEAD",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    const response = await fetch(`${endpoint}/${container}/${blobPath}`, {
      method: "HEAD",
      headers,
    });

    if (response.status === 404) {
      throw new ObjectNotFoundError(uri);
    }
    if (!response.ok) {
      throw new Error(
        `Azure Blob HEAD failed for ${redactStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }
    // An ABSENT header must not read as size 0: Number(null) is 0, which is
    // finite and non-negative, so the guard below would pass it through. The
    // staged-upload size cap depends on this value, so a silent 0 would wave
    // an unbounded upload past the check.
    const rawContentLength = response.headers.get("content-length");
    const contentLength = Number(rawContentLength);
    if (
      rawContentLength === null ||
      rawContentLength.trim() === "" ||
      !Number.isFinite(contentLength) ||
      contentLength < 0
    ) {
      throw new Error(
        `Azure Blob HEAD returned no usable Content-Length for ${redactStorageUri(uri)}`,
      );
    }
    return contentLength;
  }

  /**
   * Idempotently creates a container. NOT part of the `StorageDriver`
   * interface (get/put/delete/exists) — production deployments provision
   * their container out-of-band (Terraform/Helm/portal), same as an S3
   * bucket. This exists for integration-test setup against a fresh Azurite
   * container, which starts with no containers at all. A 409
   * ContainerAlreadyExists is treated as success.
   */
  async ensureContainer(container: string): Promise<void> {
    const { endpoint, headers } = this.signedRequest({
      method: "PUT",
      container,
      blobPath: "",
      // Per the shared-key spec (2015-02-21+), Content-Length must be the
      // EMPTY STRING (not "0") when the request body is empty.
      contentLength: "",
      contentType: "",
      extraHeaders: {},
      queryParams: { restype: "container" },
    });

    const response = await fetch(`${endpoint}/${container}?restype=container`, {
      method: "PUT",
      headers,
    });

    if (!response.ok && response.status !== 409) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Azure Blob container create failed for ${container}: ${response.status} ${response.statusText} ${body}`,
      );
    }
  }

  private signedRequest({
    method,
    container,
    blobPath,
    contentLength,
    contentType,
    extraHeaders,
    queryParams,
  }: {
    method: string;
    container: string;
    blobPath: string;
    contentLength: string;
    contentType: string;
    extraHeaders: Record<string, string>;
    /** Canonicalised query params (e.g. `{ restype: "container" }`) for container-level operations. */
    queryParams?: Record<string, string>;
  }): { endpoint: string; headers: Record<string, string> } {
    const date = new Date().toUTCString();
    const endpoint = this.credentials.endpointBaseUrl
      ? normalizeEndpoint(this.credentials.endpointBaseUrl)
      : defaultEndpoint(this.credentials.accountName);
    const pathStyle = isPathStyleEndpoint(
      this.credentials.endpointBaseUrl,
      this.credentials.accountName,
    );

    const xMsDate = date;
    const xMsVersion = "2021-12-02";

    const authorization = signRequest({
      method,
      contentLength,
      contentType,
      date: xMsDate,
      accountName: this.credentials.accountName,
      accountKey: this.credentials.accountKey,
      container,
      blobPath,
      extraHeaders,
      pathStyle,
      queryParams,
    });

    return {
      endpoint,
      headers: {
        "x-ms-date": xMsDate,
        "x-ms-version": xMsVersion,
        Authorization: authorization,
        ...extraHeaders,
      },
    };
  }
}

/**
 * AzureBlobStoredObjectDriverAdapter — stored-object bytes over Azure Blob
 * Storage.
 */
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type * as webModule from "node:stream/web";

import {
  getStoredObjectStorageScheme,
  redactStoredObjectStorageErrorText,
  redactStoredObjectStorageUri,
  ObjectNotFoundError,
} from "@langwatch/stored-object-contract";
import { nowInstant, toDate } from "@langwatch/time";

import type { StoredObjectStorageDriver } from "#repositories/stored-object-blob.repository";
import type { AzureCredentials } from "#services/azure-blob-credentials.service";
import { AzureBlobTokenProviderAdapter } from "#services/azure-blob-token-provider.service";

interface ParsedAzureBlobUri {
  accountName: string;
  container: string;
  blobPath: string;
}

/** Parses `azure-blob://{accountName}/{container}/{key...}` into its parts. */
function parseAzureBlobUri(uri: string): ParsedAzureBlobUri {
  const scheme = getStoredObjectStorageScheme(uri); // throws on non-supported schemes
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

/** Path-style endpoint (Azurite) vs host-style (production Azure). */
function isPathStyleEndpoint(endpointBaseUrl: string | undefined, accountName: string): boolean {
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

/** Ordinal (byte) comparison — never localeCompare, which is locale-sensitive. */
function compareByteOrder(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Builds the canonicalised resource path Azure uses for the shared-key
 * authorization signature. See:
 * https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
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
 * Appends canonicalized query params per spec; only container-level operations use them.
 */
function withCanonicalisedQuery(resource: string, queryParams: Record<string, string>): string {
  // Spec: lowercase the parameter name FIRST, then sort those names with an
  // ordinal (byte) comparison. Sorting the original key and lowercasing after
  // reorders a mixed-case param, and localeCompare is locale-sensitive — both
  // produce a signature Azure computes differently and rejects with a 403.
  const lines = Object.entries(queryParams)
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .toSorted(([a], [b]) => compareByteOrder(a, b))
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
    .toSorted(([a], [b]) => compareByteOrder(a, b));

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
  /** Query params for container-level operations only. */
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

/** Endpoint normalization: strip trailing slashes to prevent signature mismatches. */
function normalizeEndpoint(endpointBaseUrl: string): string {
  return endpointBaseUrl.replace(/\/+$/, "");
}

/**
 * The stored-object byte driver for Azure Blob Storage. Talks REST directly so
 * we don't pull in the full @azure/storage-blob SDK for one driver.
 */
export class AzureBlobStoredObjectDriverAdapter implements StoredObjectStorageDriver {
  static create(credentials: AzureCredentials): AzureBlobStoredObjectDriverAdapter {
    return new AzureBlobStoredObjectDriverAdapter(credentials);
  }

  private constructor(private readonly credentials: AzureCredentials) {}

  private resolvedEndpoint(): string {
    return this.credentials.endpointBaseUrl
      ? normalizeEndpoint(this.credentials.endpointBaseUrl)
      : defaultEndpoint(this.credentials.accountName);
  }

  async get(uri: string): Promise<Readable> {
    const { container, blobPath } = parseAzureBlobUri(uri);
    const endpoint = this.resolvedEndpoint();

    const response = await this.signedFetch({
      url: `${endpoint}/${container}/${blobPath}`,
      method: "GET",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    if (response.status === 404) {
      throw new ObjectNotFoundError(uri);
    }
    if (!response.ok) {
      throw new Error(
        `Azure Blob GET failed for ${redactStoredObjectStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error(
        `Azure Blob GET returned empty body for ${redactStoredObjectStorageUri(uri)}`,
      );
    }
    return Readable.fromWeb(response.body as unknown as webModule.ReadableStream<Uint8Array>);
  }

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    const { container, blobPath } = parseAzureBlobUri(uri);
    const endpoint = this.resolvedEndpoint();

    // Content-Length is deliberately NOT set as a request header: undici
    // computes it from the body and rejects a manually supplied duplicate.
    // For shared-key mode the signature covers the value undici puts on the
    // wire (see signedHeaders' Content-Length handling).
    const response = await this.signedFetch({
      url: `${endpoint}/${container}/${blobPath}`,
      method: "PUT",
      container,
      blobPath,
      // Per the shared-key spec (x-ms-version 2015-02-21+, and we pin 2021-12-02), the
      // Content-Length line of the string-to-sign is the EMPTY STRING — not "0" — when the body
      // is empty. Signing "0" yields a well-formed SharedKey header that Azure/Azurite rejects
      // with 403 AuthorizationFailure. Reachable in production: a zero-byte staged dataset
      // upload (putStaged has a max cap, no minimum).
      contentLength: bytes.length > 0 ? String(bytes.length) : "",
      contentType: mediaType,
      extraHeaders: { "x-ms-blob-type": "BlockBlob" },
      extraRequestHeaders: { "Content-Type": mediaType },
      body: new Uint8Array(bytes),
    });

    if (!response.ok) {
      const body = redactStoredObjectStorageErrorText(await response.text().catch(() => ""));
      throw new Error(
        `Azure Blob PUT failed for ${redactStoredObjectStorageUri(uri)}: ${response.status} ${response.statusText} ${body}`,
      );
    }
  }

  async delete(uri: string): Promise<void> {
    const { container, blobPath } = parseAzureBlobUri(uri);
    const endpoint = this.resolvedEndpoint();

    const response = await this.signedFetch({
      url: `${endpoint}/${container}/${blobPath}`,
      method: "DELETE",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    // Delete is idempotent: 404 means it was already gone, which is the
    // success condition for callers (the row is going away anyway).
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Azure Blob DELETE failed for ${redactStoredObjectStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }
  }

  async exists(uri: string): Promise<boolean> {
    const { container, blobPath } = parseAzureBlobUri(uri);
    const endpoint = this.resolvedEndpoint();

    const response = await this.signedFetch({
      url: `${endpoint}/${container}/${blobPath}`,
      method: "HEAD",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `Azure Blob HEAD failed for ${redactStoredObjectStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }
    return true;
  }

  /**
   * Returns blob size via HEAD without downloading; used by staged-upload finalize path.
   */
  async head(uri: string): Promise<number> {
    const { container, blobPath } = parseAzureBlobUri(uri);
    const endpoint = this.resolvedEndpoint();

    const response = await this.signedFetch({
      url: `${endpoint}/${container}/${blobPath}`,
      method: "HEAD",
      container,
      blobPath,
      contentLength: "",
      contentType: "",
      extraHeaders: {},
    });

    if (response.status === 404) {
      throw new ObjectNotFoundError(uri);
    }
    if (!response.ok) {
      throw new Error(
        `Azure Blob HEAD failed for ${redactStoredObjectStorageUri(uri)}: ${response.status} ${response.statusText}`,
      );
    }
    // An ABSENT header must not read as size 0: Number(null) is 0, which is
    // finite and non-negative, so the guard below would pass it through. The
    // staged-upload size cap depends on this value, so a silent 0 would wave
    // an unbounded upload past the check.
    const rawContentLength = response.headers.get("content-length");
    const contentLength = Number(rawContentLength);
    const hasUnusableContentLength =
      rawContentLength === null ||
      rawContentLength.trim() === "" ||
      !Number.isFinite(contentLength) ||
      contentLength < 0;
    if (hasUnusableContentLength) {
      throw new Error(
        `Azure Blob HEAD returned no usable Content-Length for ${redactStoredObjectStorageUri(uri)}`,
      );
    }
    return contentLength;
  }

  /**
   * Idempotently creates container for test setup; not part of StoredObjectStorageDriver interface.
   */
  async ensureContainer(container: string): Promise<void> {
    const endpoint = this.resolvedEndpoint();

    const response = await this.signedFetch({
      url: `${endpoint}/${container}?restype=container`,
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

    if (!response.ok && response.status !== 409) {
      const body = redactStoredObjectStorageErrorText(await response.text().catch(() => ""));
      throw new Error(
        `Azure Blob container create failed for ${container}: ${response.status} ${response.statusText} ${body}`,
      );
    }
  }

  /**
   * Computes request headers for both SharedKey and token-based authentication.
   */
  private async signedHeaders({
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
    /** Query params for container-level operations only. */
    queryParams?: Record<string, string>;
  }): Promise<Record<string, string>> {
    const date = toDate(nowInstant()).toUTCString();
    const xMsVersion = "2021-12-02"; // Supports both SharedKey and Entra (OAuth) authentication.

    if (this.credentials.mode === "sharedKey") {
      const pathStyle = isPathStyleEndpoint(
        this.credentials.endpointBaseUrl,
        this.credentials.accountName,
      );
      const authorization = signRequest({
        method,
        contentLength,
        contentType,
        date,
        accountName: this.credentials.accountName,
        accountKey: this.credentials.accountKey,
        container,
        blobPath,
        extraHeaders,
        pathStyle,
        queryParams,
      });
      return {
        "x-ms-date": date,
        "x-ms-version": xMsVersion,
        Authorization: authorization,
        ...extraHeaders,
      };
    }

    const token = await AzureBlobTokenProviderAdapter.getAzureBlobToken(this.credentials);
    return {
      "x-ms-date": date,
      "x-ms-version": xMsVersion,
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    };
  }

  /**
   * Signs requests with 401/403 auth error handling for token-based modes.
   */
  private async signedFetch({
    url,
    method,
    container,
    blobPath,
    contentLength,
    contentType,
    extraHeaders,
    queryParams,
    extraRequestHeaders,
    body,
  }: {
    url: string;
    method: string;
    container: string;
    blobPath: string;
    contentLength: string;
    contentType: string;
    extraHeaders: Record<string, string>;
    queryParams?: Record<string, string>;
    /** Headers for fetch() but not signature. */
    extraRequestHeaders?: Record<string, string>;
    /** Request body as Uint8Array; avoids SharedArrayBuffer which fetch rejects. */
    body?: Uint8Array<ArrayBuffer>;
  }): Promise<Response> {
    const buildHeaders = () =>
      this.signedHeaders({
        method,
        container,
        blobPath,
        contentLength,
        contentType,
        extraHeaders,
        queryParams,
      });

    const headers = await buildHeaders();
    const response = await fetch(url, {
      method,
      headers: { ...headers, ...extraRequestHeaders },
      body,
    });

    if (this.credentials.mode === "sharedKey") {
      return response;
    }

    if (response.status === 401) {
      AzureBlobTokenProviderAdapter.invalidateAzureBlobToken(this.credentials);
      const retryHeaders = await buildHeaders();
      return fetch(url, {
        method,
        headers: { ...retryHeaders, ...extraRequestHeaders },
        body,
      });
    }

    if (response.status === 403) {
      // The account and container are tenant-identifying — the same two
      // segments redactStorageUri strips from every other storage error. The
      // operator does not need them echoed to act on this: the remedy is a
      // role assignment on the account they already configured.
      throw new Error(
        "Azure Blob request denied (403): the identity lacks data permissions " +
          'on the configured storage account. Grant the "Storage Blob Data ' +
          'Contributor" role at the account or container scope. Note the ' +
          'control-plane "Contributor" role does NOT grant data access.',
      );
    }

    return response;
  }
}

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
 * Builds the canonicalised resource path Azure uses for the shared-key
 * authorization signature. See:
 * https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
 */
function canonicalisedResource(
  accountName: string,
  container: string,
  blobPath: string,
): string {
  return `/${accountName}/${container}/${blobPath}`;
}

/**
 * Builds the canonicalised headers block for the shared-key signature.
 * All `x-ms-*` headers are lowercased, sorted, and joined with `\n`.
 */
function canonicalisedHeaders(headers: Record<string, string>): string {
  const xMsHeaders = Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-ms-"))
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b));

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
    canonicalisedResource(accountName, container, blobPath),
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
      contentLength: String(bytes.length),
      contentType: mediaType,
      extraHeaders: { "x-ms-blob-type": "BlockBlob" },
    });

    const response = await fetch(`${endpoint}/${container}/${blobPath}`, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": mediaType,
        "Content-Length": String(bytes.length),
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

  private signedRequest({
    method,
    container,
    blobPath,
    contentLength,
    contentType,
    extraHeaders,
  }: {
    method: string;
    container: string;
    blobPath: string;
    contentLength: string;
    contentType: string;
    extraHeaders: Record<string, string>;
  }): { endpoint: string; headers: Record<string, string> } {
    const date = new Date().toUTCString();
    const endpoint =
      this.credentials.endpointBaseUrl ?? defaultEndpoint(this.credentials.accountName);

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

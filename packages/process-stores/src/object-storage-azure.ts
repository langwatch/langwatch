/**
 * Azure Blob as one placed backend, over the REST API directly: shared-key or
 * bearer-token requests, a streamed Put Blob, and a SAS upload URL signed by
 * the account key or by a user-delegation key under a token identity.
 */
import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { toDate, type Instant } from "@langwatch/time";

import type {
  Clock,
  DownloadFacts,
  ObjectBodyFacts,
  ObjectDigest,
  SignedObjectUpload,
  StoredObjectAddress,
  UploadFacts,
} from "./members.ts";
import {
  azureTokenSource,
  type AzureCredentials,
  type AzureTokenSource,
} from "./object-storage-azure-credentials.ts";
import {
  digestOf,
  measureBody,
  secondsUntil,
  StoredObjectNotFoundError,
  type ObjectBackend,
} from "./object-storage-backend.ts";

const API_VERSION = "2021-12-02";
const UPLOAD_PERMISSIONS = "cw";
const DOWNLOAD_PERMISSIONS = "r";

type Body = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
type SharedKeyCredentials = Extract<AzureCredentials, { mode: "sharedKey" }>;

interface AzureRequest {
  readonly method: string;
  /** Path under the endpoint: `/{container}` or `/{container}/{key}`, or `/` for the service. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  /** Signed `x-ms-*` headers, and `content-type` where the body has one. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentLength?: number;
  readonly body?: Body;
}

/** One account and container, and how its requests are authorised. */
interface AzurePlace {
  readonly credentials: AzureCredentials;
  readonly clock: Clock;
  /** Present under a token mode, so a 401 can drop the token it rejected. */
  readonly tokens: AzureTokenSource | undefined;
  authorize(request: AzureRequest, headers: Readonly<Record<string, string>>): Promise<string>;
}

function byteOrder(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Azurite addresses the account in the path; production Azure in the host. */
function isPathStyle(endpoint: string, accountName: string): boolean {
  const segments = new URL(endpoint).pathname.split("/").filter(Boolean);
  return segments.at(-1) === accountName;
}

/** The shared-key string-to-sign (learn.microsoft.com, "Authorize with Shared Key"). */
function sharedKeySignature(options: {
  credentials: SharedKeyCredentials;
  request: AzureRequest;
  headers: Readonly<Record<string, string>>;
}): string {
  const { credentials, request, headers } = options;
  const account = credentials.accountName;
  const resourcePath = isPathStyle(credentials.endpoint, account)
    ? `/${account}/${account}${request.path}`
    : `/${account}${request.path}`;
  const canonicalHeaders = Object.entries(headers)
    .filter(([name]) => name.startsWith("x-ms-"))
    .map(([name, value]) => `${name}:${value.trim()}`)
    .toSorted(byteOrder);
  const canonicalQuery = Object.entries(request.query ?? {})
    .map(([name, value]) => `${name.toLowerCase()}:${value}`)
    .toSorted(byteOrder);
  const length = request.contentLength ?? 0;
  const contentLength = length > 0 ? String(length) : "";
  const contentType = headers["content-type"] ?? "";
  const standardHeaders = ["", "", contentLength, "", contentType, "", "", "", "", "", ""];
  const resource = [resourcePath, ...canonicalQuery].join("\n");
  const stringToSign = [request.method, ...standardHeaders, ...canonicalHeaders, resource];
  return `SharedKey ${account}:${sign(credentials.accountKey, stringToSign)}`;
}

function sign(key: string, fields: readonly string[]): string {
  return createHmac("sha256", Buffer.from(key, "base64"))
    .update(fields.join("\n"), "utf8")
    .digest("base64");
}

function azurePlace(credentials: AzureCredentials, clock: Clock): AzurePlace {
  if (credentials.mode === "sharedKey") {
    return {
      credentials,
      clock,
      tokens: undefined,
      authorize: (request, headers) =>
        Promise.resolve(sharedKeySignature({ credentials, request, headers })),
    };
  }
  const tokens = azureTokenSource({ credentials, clock });
  return {
    credentials,
    clock,
    tokens,
    authorize: async () => `Bearer ${await tokens.token()}`,
  };
}

function send(options: {
  url: URL;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: Body;
}): Promise<IncomingMessage> {
  const { url, method, headers, body } = options;
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const outgoing = transport.request(url, { method, headers }, resolve);
    outgoing.once("error", reject);
    if (body === undefined) {
      outgoing.end();
      return;
    }
    pipeline(Readable.from(body, { objectMode: false }), outgoing).catch(reject);
  });
}

async function authorisedHeaders(
  place: AzurePlace,
  request: AzureRequest,
): Promise<Record<string, string>> {
  const length = request.contentLength;
  const headers: Record<string, string> = {
    "x-ms-date": toDate(place.clock.now()).toUTCString(),
    "x-ms-version": API_VERSION,
    ...request.headers,
    ...(length === undefined ? {} : { "content-length": String(length) }),
  };
  headers.authorization = await place.authorize(request, headers);
  return headers;
}

/** One request; a bodyless one retries once on a 401, with a fresh token. */
async function call(place: AzurePlace, request: AzureRequest): Promise<IncomingMessage> {
  const url = new URL(`${place.credentials.endpoint}${request.path}`);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  const { method, body } = request;
  const headers = await authorisedHeaders(place, request);
  const response = await send({ url, method, headers, ...(body === undefined ? {} : { body }) });
  if (response.statusCode !== 401 || place.tokens === undefined) return response;
  place.tokens.invalidate();
  if (body !== undefined) return response;
  response.resume();
  return send({ url, method, headers: await authorisedHeaders(place, request) });
}

async function textOf(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function refusal(response: IncomingMessage, operation: string): Promise<Error> {
  const body = await textOf(response).catch(() => "");
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const status = `${response.statusCode ?? "no status"}${code ? ` ${code}` : ""}`;
  if (response.statusCode === 403) {
    return new Error(
      `Azure Blob ${operation} was denied (${status}): grant the identity ` +
        '"Storage Blob Data Contributor" on the account or container.',
    );
  }
  return new Error(`Azure Blob ${operation} failed: ${status}.`);
}

const blobPath = (place: AzurePlace, at: StoredObjectAddress) =>
  `/${place.credentials.container}/${at.key}`;

async function readBlob(place: AzurePlace, at: StoredObjectAddress): Promise<IncomingMessage> {
  const response = await call(place, { method: "GET", path: blobPath(place, at) });
  if (response.statusCode === 404) {
    response.resume();
    throw new StoredObjectNotFoundError(at.projectId, at.key);
  }
  if (response.statusCode !== 200) throw await refusal(response, "read");
  return response;
}

async function writeBlob(options: {
  place: AzurePlace;
  at: StoredObjectAddress;
  body: AsyncIterable<Uint8Array>;
  facts: ObjectBodyFacts;
}): Promise<ObjectDigest> {
  const { place, at, body, facts } = options;
  const measured = measureBody({ at, body, facts });
  const request: AzureRequest = {
    method: "PUT",
    path: blobPath(place, at),
    headers: { "content-type": facts.contentType, "x-ms-blob-type": "BlockBlob" },
    contentLength: facts.byteLength,
    body: measured.chunks,
  };
  const response = await call(place, request).catch((error: unknown) => {
    throw measured.failure() ?? error;
  });
  if (response.statusCode !== 201) throw measured.failure() ?? (await refusal(response, "write"));
  response.resume();
  return measured.digest();
}

async function removeBlob(place: AzurePlace, at: StoredObjectAddress): Promise<void> {
  const response = await call(place, { method: "DELETE", path: blobPath(place, at) });
  const removed = response.statusCode === 202 || response.statusCode === 404;
  if (!removed) throw await refusal(response, "delete");
  response.resume();
}

async function probeContainer(place: AzurePlace): Promise<void> {
  const response = await call(place, {
    method: "HEAD",
    path: `/${place.credentials.container}`,
    query: { restype: "container" },
  });
  if (response.statusCode !== 200) throw await refusal(response, "container probe");
  response.resume();
}

function sasTime(instant: Instant): string {
  return toDate(instant)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

/** What every blob SAS states: its permissions on one blob, until it lapses. */
interface SasTerms {
  readonly permissions: string;
  readonly resource: string;
  readonly expiry: string;
  readonly protocol: string;
}

/** The trailing snapshot, encryption-scope and five response-header fields, unused here. */
const UNUSED_SAS_TAIL = ["", "", "", "", "", "", ""];

function serviceSas(credentials: SharedKeyCredentials, terms: SasTerms): Record<string, string> {
  const { permissions, resource, expiry, protocol } = terms;
  const head = [permissions, "", expiry, resource, "", "", protocol, API_VERSION, "b"];
  return {
    sv: API_VERSION,
    sr: "b",
    sp: permissions,
    se: expiry,
    spr: protocol,
    sig: sign(credentials.accountKey, [...head, ...UNUSED_SAS_TAIL]),
  };
}

function xmlValue(xml: string, element: string): string {
  const value = xml.match(new RegExp(`<${element}>([^<]*)</${element}>`))?.[1];
  if (value === undefined) {
    throw new Error(`Azure answered a user-delegation key without <${element}>.`);
  }
  return value;
}

async function userDelegationKey(place: AzurePlace, expiry: string): Promise<string> {
  const start = sasTime(place.clock.now());
  const keyInfo =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<KeyInfo><Start>${start}</Start><Expiry>${expiry}</Expiry></KeyInfo>`;
  const body = Buffer.from(keyInfo, "utf8");
  const response = await call(place, {
    method: "POST",
    path: "/",
    query: { restype: "service", comp: "userdelegationkey" },
    headers: { "content-type": "application/xml" },
    contentLength: body.byteLength,
    body: [body],
  });
  if (response.statusCode !== 200) throw await refusal(response, "user-delegation key request");
  return textOf(response);
}

async function delegationSas(place: AzurePlace, terms: SasTerms): Promise<Record<string, string>> {
  const { permissions, resource, expiry, protocol } = terms;
  const xml = await userDelegationKey(place, expiry);
  const key = {
    skoid: xmlValue(xml, "SignedOid"),
    sktid: xmlValue(xml, "SignedTid"),
    skt: xmlValue(xml, "SignedStart"),
    ske: xmlValue(xml, "SignedExpiry"),
    sks: xmlValue(xml, "SignedService"),
    skv: xmlValue(xml, "SignedVersion"),
  };
  const fields = [
    permissions,
    "",
    expiry,
    resource,
    ...Object.values(key),
    "",
    "",
    "",
    "",
    protocol,
    API_VERSION,
    "b",
    ...UNUSED_SAS_TAIL,
  ];
  return {
    sv: API_VERSION,
    sr: "b",
    sp: permissions,
    se: expiry,
    spr: protocol,
    ...key,
    sig: sign(xmlValue(xml, "Value"), fields),
  };
}

async function signedBlobUrl(options: {
  place: AzurePlace;
  at: StoredObjectAddress;
  permissions: string;
  expiresAt: Instant;
}): Promise<string> {
  const { place, at, permissions, expiresAt } = options;
  secondsUntil({ expiresAt, now: place.clock.now() });
  const { credentials } = place;
  const terms: SasTerms = {
    permissions,
    resource: `/blob/${credentials.accountName}/${credentials.container}/${at.key}`,
    expiry: sasTime(expiresAt),
    protocol: credentials.endpoint.startsWith("https:") ? "https" : "https,http",
  };
  const query =
    credentials.mode === "sharedKey"
      ? serviceSas(credentials, terms)
      : await delegationSas(place, terms);
  const url = new URL(`${credentials.endpoint}${blobPath(place, at)}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}

async function signBlobUpload(
  place: AzurePlace,
  at: StoredObjectAddress,
  facts: UploadFacts,
): Promise<SignedObjectUpload> {
  const url = await signedBlobUrl({
    place,
    at,
    permissions: UPLOAD_PERMISSIONS,
    expiresAt: facts.expiresAt,
  });
  return {
    kind: "direct",
    url,
    headers: { "content-type": facts.contentType, "x-ms-blob-type": "BlockBlob" },
  };
}

function signBlobDownload(
  place: AzurePlace,
  at: StoredObjectAddress,
  facts: DownloadFacts,
): Promise<string> {
  return signedBlobUrl({
    place,
    at,
    permissions: DOWNLOAD_PERMISSIONS,
    expiresAt: facts.expiresAt,
  });
}

export function azureBackend(options: {
  credentials: AzureCredentials;
  clock: Clock;
}): ObjectBackend {
  const place = azurePlace(options.credentials, options.clock);
  const { accountName, container } = options.credentials;
  return {
    destination: { kind: "azure", accountName, container },
    write: (at, body, facts) => writeBlob({ place, at, body, facts }),
    read: (at) => readBlob(place, at),
    digest: async (at) => digestOf(await readBlob(place, at)),
    remove: (at) => removeBlob(place, at),
    signUpload: (at, facts) => signBlobUpload(place, at, facts),
    signDownload: (at, facts) => signBlobDownload(place, at, facts),
    probe: () => probeContainer(place),
  };
}

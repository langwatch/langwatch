/**
 * Which credential and which client each authenticated API request used, as one folded log line
 * per minute and as span attributes. Never a token, a body or a query string.
 * Spec: modules/auth/specs/request-credential-census.feature
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { Temporal, nowInstant } from "@langwatch/time";
import { trace, type Attributes } from "@opentelemetry/api";

import { createLogger, type Logger } from "../logger.ts";
import { classifyClient } from "./trafficAttribution.ts";

export const CREDENTIAL_CENSUS_LOGGER_NAME = "langwatch:api:credential-census";

export const CENSUS_CREDENTIAL_TYPES = [
  "legacy_project_key",
  "api_key",
  "cli_token",
  "session",
  "system",
] as const;
export type CensusCredentialType = (typeof CENSUS_CREDENTIAL_TYPES)[number];

export const CENSUS_CLIENTS = [
  "sdk-python",
  "sdk-typescript",
  "sdk-go",
  "sdk-other",
  "otel-exporter",
  "cli",
  "mcp",
  "hosted-mcp",
  "browser",
  "other",
] as const;
export type CensusClient = (typeof CENSUS_CLIENTS)[number];

/** Sent by the hosted MCP server on its tools' API calls, so they read apart from a local MCP. */
export const HOSTED_MCP_HEADER = "x-langwatch-mcp-host";
export const HOSTED_MCP_HEADER_VALUE = "hosted";

export const CENSUS_SPAN_ATTRIBUTES = {
  credentialType: "langwatch.auth.credential_type",
  projectId: "langwatch.auth.project_id",
  organizationId: "langwatch.auth.organization_id",
  apiKeyId: "langwatch.auth.api_key_id",
  client: "langwatch.client.name",
  sdkName: "langwatch.client.sdk_name",
  sdkVersion: "langwatch.client.sdk_version",
} as const;

/** The credential a request authenticated with: its kind and ids, never the token. */
export type RequestCredential = Readonly<{
  credentialType: CensusCredentialType;
  /** The ApiKey row id, for a key with a row. */
  apiKeyId?: string | undefined;
  projectId?: string | undefined;
  organizationId?: string | undefined;
}>;

/** Where one request's credential is noted while it is handled. */
export type CredentialSlot = { credential?: RequestCredential };

const slots = new AsyncLocalStorage<CredentialSlot>();

/** Runs `fn` with a fresh slot it can read back once the request is answered. */
export function runWithCredentialSlot<T>(fn: (slot: CredentialSlot) => T): T {
  const slot: CredentialSlot = {};

  return slots.run(slot, () => fn(slot));
}

/** The first credential noted for the request wins; outside a request this only tags the span. */
export function noteRequestCredential(credential: RequestCredential | undefined): void {
  if (!credential) return;
  try {
    const slot = slots.getStore();
    if (slot?.credential) return;
    if (slot) slot.credential = credential;
    trace.getActiveSpan()?.setAttributes(credentialSpanAttributes(credential));
  } catch {
    // Observability never fails a request.
  }
}

/** The credential noted for the request in progress, if any. */
export function notedRequestCredential(): RequestCredential | undefined {
  return slots.getStore()?.credential;
}

export type CensusClientIdentity = Readonly<{
  client: CensusClient;
  sdkName?: string | undefined;
  sdkLanguage?: string | undefined;
  sdkVersion?: string | undefined;
  userAgent?: string | undefined;
}>;

const USER_AGENT_MAX_LENGTH = 120;

/** The client a request came from, by its identity headers and then its User-Agent. */
export function censusClientOf(
  header: (name: string) => string | null | undefined,
): CensusClientIdentity {
  try {
    const attribution = classifyClient(header);
    const rawAgent = header("user-agent") ?? "";
    const agent = rawAgent.toLowerCase();
    const identity = {
      ...(attribution.clientSdkName ? { sdkName: attribution.clientSdkName } : {}),
      ...(attribution.clientSdkLanguage ? { sdkLanguage: attribution.clientSdkLanguage } : {}),
      ...(attribution.clientSdkVersion ? { sdkVersion: attribution.clientSdkVersion } : {}),
      ...(rawAgent ? { userAgent: rawAgent.slice(0, USER_AGENT_MAX_LENGTH) } : {}),
    };

    return { client: clientOf({ header, attribution, agent }), ...identity };
  } catch {
    return { client: "other" };
  }
}

function clientOf({
  header,
  attribution,
  agent,
}: {
  header: (name: string) => string | null | undefined;
  attribution: ReturnType<typeof classifyClient>;
  agent: string;
}): CensusClient {
  if (header(HOSTED_MCP_HEADER)?.toLowerCase() === HOSTED_MCP_HEADER_VALUE) return "hosted-mcp";
  if (attribution.clientSource === "cli" || agent.startsWith("langwatch-cli/")) return "cli";
  if (attribution.clientSource === "mcp") return "mcp";
  if (attribution.clientSource === "sdk") {
    return sdkClientOf({ language: attribution.clientSdkLanguage?.toLowerCase(), agent });
  }
  if (attribution.clientSource === "otel-exporter") return "otel-exporter";
  if (attribution.clientSource === "browser") return "browser";

  return "other";
}

function sdkClientOf({ language, agent }: { language: string | undefined; agent: string }) {
  const named = language ?? agent;
  if (named.includes("python")) return "sdk-python";
  if (/typescript|javascript|node/.test(named)) return "sdk-typescript";
  if (language === "go" || agent.includes("sdk-go")) return "sdk-go";

  return "sdk-other";
}

/** The span attributes of a credential, and of its client when known. */
export function credentialSpanAttributes(
  credential: RequestCredential,
  client?: CensusClientIdentity,
): Attributes {
  const attributes: Attributes = {
    [CENSUS_SPAN_ATTRIBUTES.credentialType]: credential.credentialType,
  };
  if (credential.projectId) attributes[CENSUS_SPAN_ATTRIBUTES.projectId] = credential.projectId;
  if (credential.organizationId) {
    attributes[CENSUS_SPAN_ATTRIBUTES.organizationId] = credential.organizationId;
  }
  if (credential.apiKeyId) attributes[CENSUS_SPAN_ATTRIBUTES.apiKeyId] = credential.apiKeyId;
  if (client) {
    attributes[CENSUS_SPAN_ATTRIBUTES.client] = client.client;
    if (client.sdkName) attributes[CENSUS_SPAN_ATTRIBUTES.sdkName] = client.sdkName;
    if (client.sdkVersion) attributes[CENSUS_SPAN_ATTRIBUTES.sdkVersion] = client.sdkVersion;
  }

  return attributes;
}

/** One authenticated request as the census counts it: `route` is the template, never the URL. */
export type CensusRequest = RequestCredential &
  CensusClientIdentity &
  Readonly<{ method: string; route: string; status: number; family?: string | undefined }>;

type CensusWindow = {
  startedAt: number;
  count: number;
  failedCount: number;
  last: CensusRequest;
};

export const CENSUS_WINDOW_MS = 60_000;
/** The most windows held at once; past it the oldest is written early. */
export const CENSUS_MAX_WINDOWS = 10_000;

/**
 * Folds requests into one line per minute per credential, project, route and client, with the
 * count folded in, so totals stay exact at a bounded memory.
 */
export class CredentialCensus {
  /** In the order each window opened, so the oldest is at the front. */
  readonly #windows = new Map<string, CensusWindow>();
  readonly #logger: Pick<Logger, "info">;
  readonly #now: () => number;
  readonly #windowMs: number;
  readonly #maxWindows: number;

  private constructor(options: {
    logger: Pick<Logger, "info">;
    now: () => number;
    windowMs: number;
    maxWindows: number;
  }) {
    this.#logger = options.logger;
    this.#now = options.now;
    this.#windowMs = options.windowMs;
    this.#maxWindows = options.maxWindows;
  }

  static create(options: {
    logger: Pick<Logger, "info">;
    now?: () => number;
    windowMs?: number;
    maxWindows?: number;
  }): CredentialCensus {
    return new CredentialCensus({
      logger: options.logger,
      now: options.now ?? (() => nowInstant().epochMilliseconds),
      windowMs: options.windowMs ?? CENSUS_WINDOW_MS,
      maxWindows: options.maxWindows ?? CENSUS_MAX_WINDOWS,
    });
  }

  record(request: CensusRequest): void {
    try {
      this.sweep();
      const key = windowKeyOf(request);
      const failed = request.status >= 400 ? 1 : 0;
      const open = this.#windows.get(key);
      if (open) {
        open.count += 1;
        open.failedCount += failed;
        open.last = request;
        return;
      }
      if (this.#windows.size >= this.#maxWindows) this.#closeOldest();
      this.#windows.set(key, {
        startedAt: this.#now(),
        count: 1,
        failedCount: failed,
        last: request,
      });
    } catch {
      // Observability never fails a request.
    }
  }

  /** Writes every window that has run its full minute. */
  sweep(): void {
    const closesBefore = this.#now() - this.#windowMs;
    for (const [key, window] of this.#windows) {
      if (window.startedAt > closesBefore) return;
      this.#windows.delete(key);
      this.#write(window);
    }
  }

  /** Writes every open window, finished or not. */
  flush(): void {
    for (const window of this.#windows.values()) this.#write(window);
    this.#windows.clear();
  }

  #closeOldest(): void {
    const oldest = this.#windows.entries().next();
    if (oldest.done) return;
    this.#windows.delete(oldest.value[0]);
    this.#write(oldest.value[1]);
  }

  #write(window: CensusWindow): void {
    const { last } = window;
    this.#logger.info(
      {
        credentialType: last.credentialType,
        ...(last.apiKeyId ? { apiKeyId: last.apiKeyId } : {}),
        ...(last.projectId ? { projectId: last.projectId } : {}),
        ...(last.organizationId ? { organizationId: last.organizationId } : {}),
        method: last.method,
        route: last.route,
        ...(last.family ? { family: last.family } : {}),
        client: last.client,
        ...(last.sdkName ? { sdkName: last.sdkName } : {}),
        ...(last.sdkLanguage ? { sdkLanguage: last.sdkLanguage } : {}),
        ...(last.sdkVersion ? { sdkVersion: last.sdkVersion } : {}),
        ...(last.userAgent ? { userAgent: last.userAgent } : {}),
        status: last.status,
        count: window.count,
        failedCount: window.failedCount,
        windowStartedAt: Temporal.Instant.fromEpochMilliseconds(window.startedAt).toString(),
      },
      "API credential census",
    );
  }
}

function windowKeyOf(request: CensusRequest): string {
  return JSON.stringify([
    request.credentialType,
    request.apiKeyId ?? request.projectId ?? request.organizationId ?? "",
    request.projectId ?? "",
    request.method,
    request.route,
    request.client,
  ]);
}

let processCensus: CredentialCensus | undefined;

/** Counts one request into this process's census, which writes its finished windows each minute. */
export function recordCredentialCensus(request: CensusRequest): void {
  processCensus ??= startProcessCensus();
  processCensus.record(request);
}

function startProcessCensus(): CredentialCensus {
  const census = CredentialCensus.create({ logger: createLogger(CREDENTIAL_CENSUS_LOGGER_NAME) });
  const timer = setInterval(() => census.sweep(), CENSUS_WINDOW_MS);
  timer.unref();

  return census;
}

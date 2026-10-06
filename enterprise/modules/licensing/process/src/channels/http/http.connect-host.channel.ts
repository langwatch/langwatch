/**
 * One outbound request from a self-hosted install to LangWatch (ADR-156). Both
 * hosts take the same credential and refuse with the same codes, so the
 * request and the refusal mapping live here once, over a supplied pool.
 */

import type { OutboundProxyConfig } from "@langwatch/egress";
import {
  type ConnectCredential,
  ConnectBudgetExhaustedError,
  ConnectUnreachableError,
  HostedServiceUnavailableError,
} from "@langwatch/enterprise-licensing-contract";
import {
  type HandledError,
  handledErrorFaultSchema,
  handledErrorFromHerr,
} from "@langwatch/handled-error";
import { type Dispatcher, EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { z } from "zod";

/** The connection pool one transport calls on: an undici dispatcher. */
export type ConnectDispatcher = Dispatcher;

/** How calls to LangWatch leave this install: the runtime's own fetch, or a proxy pool. */
export type ConnectTransport =
  | { readonly via: "runtime" }
  | { readonly via: "proxy"; readonly dispatcher: ConnectDispatcher };

/**
 * A proxy pool only where the deployment names a proxy, so an unrelated proxy variable never
 * changes how an install reaches LangWatch.
 */
export function connectTransportFor({
  outboundProxy,
}: {
  outboundProxy: OutboundProxyConfig;
}): ConnectTransport {
  const { httpsProxy, httpProxy, noProxy } = outboundProxy;
  if (!httpsProxy && !httpProxy && !noProxy) return { via: "runtime" };
  return {
    via: "proxy",
    dispatcher: new EnvHttpProxyAgent({
      httpProxy: httpProxy ?? "",
      httpsProxy: httpsProxy ?? "",
      noProxy: noProxy ?? "",
    }),
  };
}

/** The pool a transport names, as a channel's options take it. */
export function dispatcherOf(transport: ConnectTransport): { dispatcher?: ConnectDispatcher } {
  return transport.via === "proxy" ? { dispatcher: transport.dispatcher } : {};
}

/** Whole-request timeout. A hosted judgement is synchronous inside a query. */
const REQUEST_TIMEOUT_MS = 120_000;

const refusalBodySchema = z.object({
  type: z.string(),
  code: z.string().optional(),
  message: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
  fault: handledErrorFaultSchema.optional(),
  retryable: z.boolean().optional(),
  tips: z.array(z.string()).optional(),
  docs_url: z.string().optional(),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
});

/**
 * The gateway nests its refusal under `error`; the connect host answers the
 * standard REST body with the same fields at the root. Both read as one.
 */
const refusalSchema = z.union([
  z.object({ error: refusalBodySchema }).transform(({ error }) => error),
  refusalBodySchema,
]);

/** What this transport reads of an answered request, and nothing else. */
export interface ConnectHostResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

/** What this transport sends of a request, and nothing else. */
export interface ConnectRequestInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly dispatcher?: ConnectDispatcher;
  readonly signal: AbortSignal;
}

/** The request seam, injected so a suite never opens a socket. */
export type ConnectFetch = (url: string, init: ConnectRequestInit) => Promise<ConnectHostResponse>;

export interface ConnectHostOptions {
  /** Origin of the host; the paths are the calling channel's own. */
  readonly endpoint: string;
  /** The pool calls go out on. Absent leaves undici's default. */
  readonly dispatcher?: ConnectDispatcher;
  /** Injected by suites; the runtime's fetch otherwise, or undici's where a proxy pool is named. */
  readonly fetch?: ConnectFetch;
}

/** The transport one channel holds: one origin and one call shape. */
export class ConnectHost {
  private readonly origin: string;
  private readonly send: ConnectFetch;

  constructor(private readonly options: ConnectHostOptions) {
    this.origin = new URL(options.endpoint).origin;
    this.send = options.fetch ?? ((url, init) => sendOverRuntime({ url, init }));
  }

  /** One request, from the credential to a parsed answer or a named refusal. */
  async call<T>({
    path,
    method,
    credential,
    body,
    schema,
    signal,
  }: {
    path: string;
    method: "GET" | "POST" | "PUT";
    credential: ConnectCredential;
    body?: unknown;
    schema: z.ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T> {
    const response = await this.request({
      path,
      method,
      credential,
      body,
      ...(signal ? { signal } : {}),
    });

    if (response.status !== 200) throw await refusalOf(response);

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new HostedServiceUnavailableError({
        reasons: [new Error("the hosted service answered outside its published shape")],
      });
    }
    return parsed.data;
  }

  private async request({
    path,
    method,
    credential,
    body,
    signal,
  }: {
    path: string;
    method: "GET" | "POST" | "PUT";
    credential: ConnectCredential;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<ConnectHostResponse> {
    try {
      return await this.send(new URL(path, this.origin).toString(), {
        method,
        headers: {
          authorization: `Bearer ${credential.token}`,
          "x-langwatch-instance": credential.instanceId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(this.options.dispatcher ? { dispatcher: this.options.dispatcher } : {}),
        signal: requestSignal(signal),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ConnectUnreachableError({
        ...addressOf(this.origin),
        ...(error instanceof Error ? { cause: error } : {}),
      });
    }
  }
}

/** The host and the port an outbound rule has to allow. */
function addressOf(origin: string): { host: string; port: number } {
  const url = new URL(origin);
  if (url.port) return { host: url.hostname, port: Number.parseInt(url.port, 10) };
  return { host: url.hostname, port: url.protocol === "http:" ? 80 : 443 };
}

/**
 * The named error behind one refused call. A code the host wrote crosses as
 * itself; the budget stop is rewritten because the cap is the customer's own,
 * and so is anything the host did not author (a proxy's error page).
 */
async function refusalOf(response: ConnectHostResponse): Promise<HandledError> {
  const parsed = refusalSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return new HostedServiceUnavailableError({
      reasons: [new Error(`the hosted service refused the call with ${response.status}`)],
    });
  }

  const error = parsed.data;
  const code = error.code ?? error.type;
  if (code === "budget_exceeded") return new ConnectBudgetExhaustedError(capUsdIn(error.meta));
  if (code === "hosted_service_unavailable" || response.status >= 500) {
    return new HostedServiceUnavailableError({ reasons: [new Error(error.message)] });
  }
  return handledErrorFromHerr(error, { httpStatus: response.status });
}

/** The cap named on a budget refusal, where the host named one. */
function capUsdIn(meta: Record<string, unknown> | undefined): { capUsd?: number } {
  const value = meta?.cap_usd ?? meta?.capUsd;
  return typeof value === "number" && Number.isFinite(value) ? { capUsd: value } : {};
}

/** The caller's cancellation and our own timeout, together. */
function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** The runtime's own fetch, or undici's when a proxy pool is named (only undici's takes one). */
function sendOverRuntime({
  url,
  init,
}: {
  url: string;
  init: ConnectRequestInit;
}): Promise<ConnectHostResponse> {
  const { dispatcher, ...request } = init;
  return dispatcher ? undiciFetch(url, { ...request, dispatcher }) : fetch(url, request);
}

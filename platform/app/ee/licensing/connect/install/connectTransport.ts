/**
 * One outbound request from a self-hosted install to LangWatch (ADR-139).
 *
 * Two hosts answer an install: the gateway, which runs the hosted services,
 * and the connect host, which the license syncs against. They take the same
 * credential, refuse in the same envelope and sit behind the same proxy rules,
 * so the request, the parsing and the refusal mapping live here once and each
 * client owns only its own paths and shapes.
 *
 * Outbound traffic from a self-hosted install usually leaves through a proxy,
 * so the dispatcher honours `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` when
 * any of them is set. A connection that never lands is the one failure the
 * host cannot name for us, so it is named here with the host and port an
 * outbound rule has to allow.
 */

import type { HandledError } from "@langwatch/handled-error";
import { handledErrorFromHerr } from "@langwatch/handled-error";
import {
  Agent,
  type Dispatcher,
  EnvHttpProxyAgent,
  fetch as undiciFetch,
} from "undici";
import { z } from "zod";

import {
  ConnectBudgetExhaustedError,
  ConnectUnreachableError,
  HostedServiceUnavailableError,
} from "./connectErrors";

/** What the install presents on every call to LangWatch. */
export interface ConnectCredential {
  readonly token: string;
  readonly instanceId: string;
}

/** Seconds a pooled connection to a host is kept open between calls. */
const KEEP_ALIVE_TIMEOUT_MS = 30_000;

/** Whole-request timeout. A hosted judgement is synchronous inside a query. */
const REQUEST_TIMEOUT_MS = 120_000;

const refusalSchema = z.object({
  error: z.object({
    type: z.string(),
    code: z.string().optional(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    fault: z.enum(["customer", "platform", "provider"]).optional(),
    tips: z.array(z.string()).optional(),
    docs_url: z.string().optional(),
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
  }),
});

/**
 * The dispatcher calls to LangWatch go out on.
 *
 * A proxy agent only where the deployment asked for one: it reads the proxy
 * variables at construction, so building it unconditionally would change how
 * every install reaches LangWatch the day one of those variables appears for
 * an unrelated reason.
 */
export function createConnectDispatcher(
  environment: Record<string, string | undefined> = process.env,
): Dispatcher {
  const names = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];
  const usesProxy = names.some((name) =>
    Boolean(environment[name] ?? environment[name.toLowerCase()]),
  );
  return usesProxy
    ? new EnvHttpProxyAgent()
    : new Agent({ keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS });
}

export interface ConnectHttpOptions {
  /** Origin of the host; the paths are the calling client's own. */
  readonly endpoint: string;
  /** Injected by suites; a dispatcher built from the environment otherwise. */
  readonly dispatcher?: Dispatcher;
}

/** The transport one client holds: a keep-alive pool and one call shape. */
export class ConnectHttp {
  private readonly origin: string;
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;

  constructor(options: ConnectHttpOptions) {
    this.origin = new URL(options.endpoint).origin;
    this.ownsDispatcher = options.dispatcher === undefined;
    this.dispatcher = options.dispatcher ?? createConnectDispatcher();
  }

  async close(): Promise<void> {
    if (this.ownsDispatcher) await this.dispatcher.close();
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
    const response = await this.send({
      path,
      method,
      credential,
      body,
      ...(signal ? { signal } : {}),
    });

    if (response.status !== 200) {
      throw await refusalOf(response);
    }

    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new HostedServiceUnavailableError({
        reasons: [
          new Error("the hosted service answered outside its published shape"),
        ],
      });
    }
    return parsed.data;
  }

  private async send({
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
  }): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
    try {
      return await undiciFetch(new URL(path, this.origin).toString(), {
        method,
        headers: {
          authorization: `Bearer ${credential.token}`,
          "x-langwatch-instance": credential.instanceId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        dispatcher: this.dispatcher,
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
  const port = url.port
    ? Number.parseInt(url.port, 10)
    : url.protocol === "http:"
      ? 80
      : 443;
  return { host: url.hostname, port };
}

/**
 * The named error behind one refused call.
 *
 * A code the host wrote crosses as itself, which is what keeps one piece of
 * copy per refusal on both sides. Two are rewritten: the gateway's budget stop,
 * because the cap behind it is the customer's own and is raised in these
 * settings; and anything that is not a refusal the host authored, because a
 * proxy's error page is not the host answering.
 */
async function refusalOf(
  response: Awaited<ReturnType<typeof undiciFetch>>,
): Promise<HandledError> {
  const parsed = refusalSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    return new HostedServiceUnavailableError({
      reasons: [
        new Error(
          `the hosted service refused the call with ${response.status}`,
        ),
      ],
    });
  }

  const { error } = parsed.data;
  const code = error.code ?? error.type;
  if (code === "budget_exceeded") {
    return new ConnectBudgetExhaustedError(capUsdIn(error.meta));
  }
  if (code === "hosted_service_unavailable" || response.status >= 500) {
    return new HostedServiceUnavailableError({
      reasons: [new Error(error.message)],
    });
  }
  return handledErrorFromHerr(error, { httpStatus: response.status });
}

/** The cap named on a budget refusal, where the host named one. */
function capUsdIn(meta: Record<string, unknown> | undefined): {
  capUsd?: number;
} {
  const value = meta?.cap_usd ?? meta?.capUsd;
  return typeof value === "number" && Number.isFinite(value)
    ? { capUsd: value }
    : {};
}

/** The caller's cancellation and our own timeout, together. */
function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

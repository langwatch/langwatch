/**
 * The install's transport to LangWatch-hosted services (ADR-139).
 *
 * Three routes, one credential: the token derived from the license the
 * organization already holds, plus the instance id that binds the license to
 * this install. Every answer is parsed against the published shape, and every
 * refusal becomes a named error the administrator of the install can act on.
 *
 * Outbound traffic from a self-hosted install usually leaves through a proxy,
 * so the dispatcher honours `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` when
 * any of them is set. A connection that never lands is the one failure the
 * host cannot name for us, so it is named here with the host and port an
 * outbound rule has to allow.
 *
 * @see ../hostedServices.service.ts, what answers these routes
 * @see ../../../../../specs/self-hosting/connected-services/connect-settings.feature
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

import type { InstantEvalQuestion } from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  ConnectBudgetExhaustedError,
  ConnectUnreachableError,
  HostedServiceUnavailableError,
} from "./connectErrors";

/** What the install presents on every hosted call. */
export interface ConnectCredential {
  readonly token: string;
  readonly instanceId: string;
}

/** Seconds a pooled connection to the host is kept open between calls. */
const KEEP_ALIVE_TIMEOUT_MS = 30_000;

/** Whole-request timeout. A hosted judgement is synchronous inside a query. */
const REQUEST_TIMEOUT_MS = 120_000;

const verdictSchema = z.object({
  questionId: z.string(),
  probability: z.number().optional(),
  score: z.number().optional(),
  label: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

const classifyAnswerSchema = z.object({
  verdicts: z.array(verdictSchema),
  skipped_reason: z.string().optional(),
  input_tokens: z.number(),
  is_text_truncated: z.boolean(),
  charged_usd: z.number(),
});

const budgetSchema = z.object({
  id: z.string(),
  scope: z.string(),
  window: z.string(),
  cap_usd: z.number(),
  spent_usd: z.number().nullable(),
  remaining_usd: z.number().nullable(),
  on_breach: z.string(),
  period_started_at: z.string(),
  is_contract: z.boolean(),
});

const contractSchema = budgetSchema.extend({
  commit_usd: z.number(),
  maximum_cap_usd: z.number(),
  overage_enabled: z.boolean(),
  term_ends_at: z.string().nullable(),
});

const usageAnswerSchema = z.object({
  services: z.array(z.string()),
  spend_available: z.boolean(),
  read_at: z.string(),
  contract: contractSchema.nullable(),
  budgets: z.array(budgetSchema),
});

const setBudgetAnswerSchema = z.object({
  cap_usd: z.number(),
  maximum_cap_usd: z.number(),
});

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

/** One judged text, as the host answers it. */
export interface ConnectClassifyAnswer {
  readonly verdicts: z.infer<typeof verdictSchema>[];
  readonly skippedReason?: string;
  readonly inputTokens: number;
  readonly isTextTruncated: boolean;
  readonly chargedUsd: number;
}

export interface ConnectBudget {
  readonly id: string;
  readonly scope: string;
  readonly window: string;
  readonly capUsd: number;
  readonly spentUsd: number | null;
  readonly remainingUsd: number | null;
  readonly onBreach: string;
  readonly periodStartedAt: string;
  readonly isContract: boolean;
}

export interface ConnectContract extends ConnectBudget {
  readonly commitUsd: number;
  readonly maximumCapUsd: number;
  readonly overageEnabled: boolean;
  readonly termEndsAt: string | null;
}

export interface ConnectUsage {
  readonly services: string[];
  readonly spendAvailable: boolean;
  readonly readAt: string;
  readonly contract: ConnectContract | null;
  readonly budgets: ConnectBudget[];
}

/**
 * The dispatcher hosted calls go out on.
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

export interface ConnectGatewayClientOptions {
  /** Origin of the hosted services host; the paths are this client's own. */
  readonly endpoint: string;
  /** Injected by suites; a dispatcher built from the environment otherwise. */
  readonly dispatcher?: Dispatcher;
}

export class ConnectGatewayClient {
  private readonly origin: string;
  private readonly dispatcher: Dispatcher;
  private readonly ownsDispatcher: boolean;

  constructor(options: ConnectGatewayClientOptions) {
    this.origin = new URL(options.endpoint).origin;
    this.ownsDispatcher = options.dispatcher === undefined;
    this.dispatcher = options.dispatcher ?? createConnectDispatcher();
  }

  async close(): Promise<void> {
    if (this.ownsDispatcher) await this.dispatcher.close();
  }

  async classify({
    credential,
    text,
    questions,
    signal,
  }: {
    credential: ConnectCredential;
    text: string;
    questions: readonly InstantEvalQuestion[];
    signal?: AbortSignal;
  }): Promise<ConnectClassifyAnswer> {
    const answer = await this.call({
      path: "/v1/instant-evals/classify",
      method: "POST",
      credential,
      body: { text, questions },
      schema: classifyAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      verdicts: answer.verdicts,
      ...(answer.skipped_reason
        ? { skippedReason: answer.skipped_reason }
        : {}),
      inputTokens: answer.input_tokens,
      isTextTruncated: answer.is_text_truncated,
      chargedUsd: answer.charged_usd,
    };
  }

  async usage({
    credential,
    signal,
  }: {
    credential: ConnectCredential;
    signal?: AbortSignal;
  }): Promise<ConnectUsage> {
    const answer = await this.call({
      path: "/v1/usage",
      method: "GET",
      credential,
      schema: usageAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      services: answer.services,
      spendAvailable: answer.spend_available,
      readAt: answer.read_at,
      contract: answer.contract
        ? {
            ...budgetOf(answer.contract),
            commitUsd: answer.contract.commit_usd,
            maximumCapUsd: answer.contract.maximum_cap_usd,
            overageEnabled: answer.contract.overage_enabled,
            termEndsAt: answer.contract.term_ends_at,
          }
        : null,
      budgets: answer.budgets.map(budgetOf),
    };
  }

  async setBudget({
    credential,
    capUsd,
    signal,
  }: {
    credential: ConnectCredential;
    capUsd: number;
    signal?: AbortSignal;
  }): Promise<{ capUsd: number; maximumCapUsd: number }> {
    const answer = await this.call({
      path: "/v1/budget",
      method: "PUT",
      credential,
      body: { cap_usd: capUsd },
      schema: setBudgetAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      capUsd: answer.cap_usd,
      maximumCapUsd: answer.maximum_cap_usd,
    };
  }

  /** One request, from the credential to a parsed answer or a named refusal. */
  private async call<T>({
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

function budgetOf(budget: z.infer<typeof budgetSchema>): ConnectBudget {
  return {
    id: budget.id,
    scope: budget.scope,
    window: budget.window,
    capUsd: budget.cap_usd,
    spentUsd: budget.spent_usd,
    remainingUsd: budget.remaining_usd,
    onBreach: budget.on_breach,
    periodStartedAt: budget.period_started_at,
    isContract: budget.is_contract,
  };
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

let shared: { endpoint: string; client: ConnectGatewayClient } | undefined;

/**
 * The process's client for one endpoint.
 *
 * One instance because the dispatcher is a keep-alive pool; a second would
 * open a second set of connections to the same host.
 */
export function getConnectGatewayClient(
  endpoint: string,
): ConnectGatewayClient {
  if (shared?.endpoint !== endpoint) {
    // Releases the pool of the endpoint being replaced rather than leaving its
    // sockets open for the life of the process.
    void shared?.client.close().catch(() => undefined);
    shared = { endpoint, client: new ConnectGatewayClient({ endpoint }) };
  }
  return shared.client;
}

/** Drops the shared client. For suites, and for a clean shutdown. */
export async function resetConnectGatewayClient(): Promise<void> {
  const previous = shared;
  shared = undefined;
  await previous?.client.close();
}

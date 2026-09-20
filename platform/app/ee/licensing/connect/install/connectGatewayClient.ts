/**
 * The install's client for LangWatch-hosted services (ADR-139).
 *
 * Three routes, one credential: the token derived from the license the
 * organization already holds, plus the instance id that binds the license to
 * this install. Every answer is parsed against the published shape, and every
 * refusal becomes a named error the administrator of the install can act on.
 * The request itself, the proxy rules and the refusal mapping are the shared
 * transport's.
 *
 * @see ./connectTransport.ts, how a call is made and how a refusal is named
 * @see ../hostedServices.service.ts, what answers these routes
 * @see ../../../../../specs/self-hosting/connected-services/connect-settings.feature
 */

import type { Dispatcher } from "undici";
import { z } from "zod";

import type { InstantEvalQuestion } from "~/server/app-layer/instant-evals/classifier/classifier";
import { type ConnectCredential, ConnectHttp } from "./connectTransport";

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

/**
 * The published shape of the usage answer. Exported so the host's own suite can
 * parse what it returns against the schema the install applies to it, which is
 * what keeps the two halves of this route from drifting apart.
 */
export const usageAnswerSchema = z.object({
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

export interface ConnectGatewayClientOptions {
  /** Origin of the hosted services host; the paths are this client's own. */
  readonly endpoint: string;
  /** Injected by suites; a dispatcher built from the environment otherwise. */
  readonly dispatcher?: Dispatcher;
}

export class ConnectGatewayClient {
  private readonly http: ConnectHttp;

  constructor(options: ConnectGatewayClientOptions) {
    this.http = new ConnectHttp(options);
  }

  async close(): Promise<void> {
    await this.http.close();
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
    const answer = await this.http.call({
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
    const answer = await this.http.call({
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
    const answer = await this.http.call({
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

import type { connectBudgetSchema } from "@langwatch/enterprise-licensing-contract";
import {
  type ConnectBudgetView,
  type ConnectClassifyAnswer,
  type ConnectCredential,
  type ConnectUsageView,
  connectClassifyAnswerSchema,
  connectSetBudgetAnswerSchema,
  connectUsageAnswerSchema,
} from "@langwatch/enterprise-licensing-contract";
import type { z } from "zod";

import { ConnectGatewayChannel } from "../connect-gateway.channel.ts";
import { type ConnectHostOptions, ConnectHost } from "./http.connect-host.channel.ts";

/** Origin of the hosted services host; the paths are this channel's own. */
export type HttpConnectGatewayChannelOptions = ConnectHostOptions;

/** The three hosted routes, over the shared transport. */
export class HttpConnectGatewayChannel extends ConnectGatewayChannel {
  private constructor(private readonly host: ConnectHost) {
    super();
  }

  static create(options: HttpConnectGatewayChannelOptions): HttpConnectGatewayChannel {
    return new HttpConnectGatewayChannel(new ConnectHost(options));
  }

  async classify({
    credential,
    text,
    questions,
    signal,
  }: {
    credential: ConnectCredential;
    text: string;
    questions: readonly unknown[];
    signal?: AbortSignal;
  }): Promise<ConnectClassifyAnswer> {
    const answer = await this.host.call({
      path: "/v1/instant-evals/classify",
      method: "POST",
      credential,
      body: { text, questions },
      schema: connectClassifyAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return {
      verdicts: answer.verdicts,
      ...(answer.skipped_reason ? { skippedReason: answer.skipped_reason } : {}),
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
  }): Promise<ConnectUsageView> {
    const answer = await this.host.call({
      path: "/v1/usage",
      method: "GET",
      credential,
      schema: connectUsageAnswerSchema,
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
    const answer = await this.host.call({
      path: "/v1/budget",
      method: "PUT",
      credential,
      body: { cap_usd: capUsd },
      schema: connectSetBudgetAnswerSchema,
      ...(signal ? { signal } : {}),
    });
    return { capUsd: answer.cap_usd, maximumCapUsd: answer.maximum_cap_usd };
  }
}

function budgetOf(budget: z.infer<typeof connectBudgetSchema>): ConnectBudgetView {
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

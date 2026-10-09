/**
 * The hosted services a self-hosted license calls on LangWatch Cloud (ADR-156
 * §5). The gateway authenticated the caller and applied the budget stop; what
 * is decided here is whether the key's license includes the service.
 */

import type { HostedCapAnswer, HostedClassifyAnswer } from "@langwatch/enterprise-connect-contract";
import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
  type ConnectService,
  type ContractTerms,
  type HostedBudgetWire,
  type HostedCaller,
  type HostedUsageAnswer,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import type {
  InstantEvalJudgement,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";

import {
  hostedBudgetPayloadSchema,
  hostedClassifyPayloadSchema,
  parseHostedPayload,
} from "../rules/hosted-payload.rules.ts";
import type { ConnectSpendEntry } from "./connect-spend-buffer.service.ts";
import type { ContractBudgetService } from "./contract-budget.service.ts";
import type { HostedBudgetUsage, HostedUsageReader } from "./hosted-usage-reader.service.ts";

const CENTS = 100;
const INSTANT_EVALS: ConnectService = "instant_evals";

interface HostedServicesCollaborators {
  licenses: Pick<LicensingApi, "findManagedKeyLicense" | "getContractTerms">;
  judge: HostedJudge;
  spend: { add(entry: ConnectSpendEntry): void };
  usage: HostedUsageReader;
  contractBudgets: Pick<ContractBudgetService, "setCap">;
}

export class HostedServicesService {
  static create(collaborators: HostedServicesCollaborators): HostedServicesService {
    return new HostedServicesService(collaborators);
  }

  private constructor(private readonly collaborators: HostedServicesCollaborators) {}

  async classify({
    caller,
    payload,
    signal,
  }: {
    caller: HostedCaller;
    payload: unknown;
    signal?: AbortSignal;
  }): Promise<HostedClassifyAnswer> {
    const license = await this.#activeLicenseOf(caller);
    if (!license?.services.includes(INSTANT_EVALS)) {
      throw new ConnectServiceNotEntitledError(INSTANT_EVALS);
    }
    const request = parseHostedPayload(hostedClassifyPayloadSchema, payload);
    // The rate share is per customer: the hidden project is one per
    // organization, and a key with none falls back to itself.
    const projectId = caller.projectId ?? caller.virtualKeyId;

    const judgement = await this.collaborators.judge.classify(
      { projectId, text: request.text, questions: request.questions },
      signal,
    );
    const { costUsd, priceUsd } = this.collaborators.judge.priceOf({
      inputTokens: judgement.inputTokens,
    });

    // A skipped judgement billed no tokens, so there is nothing to meter.
    if (judgement.inputTokens > 0) {
      this.collaborators.spend.add({
        virtualKeyId: caller.virtualKeyId,
        projectId,
        inputTokens: judgement.inputTokens,
        costUsd,
        priceUsd,
      });
    }

    // The list price is what the customer is charged and all it is told. What
    // the judge costs LangWatch stays on the spend row.
    return {
      verdicts: judgement.verdicts.map((verdict) => ({ ...verdict })),
      ...(judgement.skippedReason ? { skipped_reason: judgement.skippedReason } : {}),
      input_tokens: judgement.inputTokens,
      is_text_truncated: judgement.isTextTruncated,
      charged_usd: priceUsd,
    };
  }

  async usage({ caller }: { caller: HostedCaller }): Promise<HostedUsageAnswer> {
    const [license, reading] = await Promise.all([
      this.#activeLicenseOf(caller),
      this.collaborators.usage.read(caller),
    ]);
    const terms: ContractTerms | null = license
      ? await this.collaborators.licenses.getContractTerms({
          organizationId: caller.organizationId,
        })
      : null;
    const contract = reading.budgets.find((budget) => budget.isContract);

    return {
      services: terms?.services ?? [],
      spend_available: reading.spendAvailable,
      read_at: reading.readAt.toString(),
      contract:
        terms && contract
          ? {
              ...budgetWire(contract),
              commit_usd: terms.commitUsdCents / CENTS,
              maximum_cap_usd: terms.maximumUsdCents / CENTS,
              overage_enabled: terms.overageEnabled,
              term_ends_at: terms.termEndsAt,
            }
          : null,
      budgets: reading.budgets.map(budgetWire),
    };
  }

  async setBudget({
    caller,
    payload,
  }: {
    caller: HostedCaller;
    payload: unknown;
  }): Promise<HostedCapAnswer> {
    const license = await this.#activeLicenseOf(caller);
    if (!license) throw new ConnectLicenseRequiredError();
    const { cap_usd } = parseHostedPayload(hostedBudgetPayloadSchema, payload);

    const { capUsdCents, maximumUsdCents } = await this.collaborators.contractBudgets.setCap({
      organizationId: caller.organizationId,
      capUsdCents: Math.round(cap_usd * CENTS),
    });
    return { cap_usd: capUsdCents / CENTS, maximum_cap_usd: maximumUsdCents / CENTS };
  }

  /**
   * The active license the calling key belongs to, or null for a plain virtual key.
   * The gateway serves a resolved credential for minutes, so licensing is asked again here.
   */
  async #activeLicenseOf(caller: HostedCaller): Promise<{ services: ConnectService[] } | null> {
    const [license] = await this.collaborators.licenses.findManagedKeyLicense({
      virtualKeyId: caller.virtualKeyId,
      organizationId: caller.organizationId,
    });
    return license ?? null;
  }
}

function budgetWire(budget: HostedBudgetUsage): HostedBudgetWire {
  return {
    id: budget.id,
    scope: budget.scope,
    window: budget.window,
    on_breach: budget.onBreach,
    cap_usd: budget.limitUsd,
    spent_usd: budget.spentUsd,
    remaining_usd: budget.spentUsd === null ? null : Math.max(0, budget.limitUsd - budget.spentUsd),
    period_started_at: budget.periodStartedAt.toString(),
    is_contract: budget.isContract,
  };
}

/**
 * The judge a hosted classify call reaches, and what its answer is worth. Both
 * belong to instant-eval; connect states only what a hosted call needs.
 */
export interface HostedJudge {
  classify(
    input: { projectId: string; text: string; questions: readonly InstantEvalQuestion[] },
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement>;
  /** What one judgement cost LangWatch, and what the customer is charged. */
  priceOf(input: { inputTokens: number }): { costUsd: number; priceUsd: number };
}

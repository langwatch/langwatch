/**
 * The hosted services a self-hosted license calls on LangWatch Cloud (ADR-156
 * §5). The gateway authenticated the caller and applied the budget stop; what
 * is decided here is whether the key's license includes the service.
 */

import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
  type ContractTerms,
  type HostedBudgetWire,
  type HostedCapAnswer,
  type HostedCaller,
  type HostedClassifyAnswer,
  type HostedUsageAnswer,
} from "@langwatch/enterprise-licensing-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  HostedBudgetUsage,
  HostedJudge,
  HostedUsageReader,
} from "../app/licensing.members.ts";
import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import {
  hostedBudgetPayloadSchema,
  hostedClassifyPayloadSchema,
  parseHostedPayload,
} from "../rules/hosted-payload.rules.ts";
import { statusOfIssuedLicense } from "../rules/issued-license.rules.ts";
import type { ConnectSpendEntry } from "./connect-spend-buffer.service.ts";
import type { ContractBudgetService } from "./contract-budget.service.ts";

const CENTS = 100;
const INSTANT_EVALS = "instant_evals";

export interface HostedServicesCollaborators {
  licenses: Pick<IssuedLicenseRepository, "findByVirtualKeyId">;
  judge: HostedJudge;
  spend: { add(entry: ConnectSpendEntry): void };
  usage: HostedUsageReader;
  contractBudgets: Pick<ContractBudgetService, "setCap" | "termsOf">;
  now?: () => Instant;
}

export class HostedServicesService {
  static create(collaborators: HostedServicesCollaborators): HostedServicesService {
    return new HostedServicesService(collaborators);
  }

  readonly #now: () => Instant;

  private constructor(private readonly collaborators: HostedServicesCollaborators) {
    this.#now = collaborators.now ?? nowInstant;
  }

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
      ? await this.collaborators.contractBudgets.termsOf(caller.organizationId)
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
   * The license the calling key belongs to, or null for a plain virtual key.
   * The credential was checked when the gateway resolved it, but a gateway
   * serves a cached credential for minutes, so state is read again here.
   */
  async #activeLicenseOf(caller: HostedCaller): Promise<IssuedLicenseRecord | null> {
    const license = await this.collaborators.licenses.findByVirtualKeyId(caller.virtualKeyId);
    if (!license || license.organizationId !== caller.organizationId) return null;
    return statusOfIssuedLicense(license, this.#now()) === "active" ? license : null;
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

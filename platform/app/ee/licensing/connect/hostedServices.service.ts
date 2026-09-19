/**
 * The hosted services a self-hosted license calls on LangWatch Cloud (ADR-139):
 * judge a text, read usage, set the customer's own cap.
 *
 * The gateway has already authenticated the caller and applied the budget stop.
 * What is decided here is what the gateway cannot know: whether the key belongs
 * to a license, and whether that license includes the service.
 *
 * Judged text and questions pass through to the classifier and are never
 * written anywhere. Spend carries token counts and cost only.
 */

import { ValidationError } from "@langwatch/handled-error";
import { z } from "zod";
import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  instantEvalCostUsd,
  instantEvalPriceUsd,
} from "~/server/app-layer/instant-evals/classifier/pricing";
import { instantEvalQuestionSchema } from "~/server/app-layer/instant-evals/classifier/questions";
import type { IssuedLicenseRecord } from "../registry/licenseRegistry.service";
import { statusOfIssuedLicense } from "../registry/licenseRegistry.service";
import type { ConnectSpendEntry } from "./connectSpendBuffer";
import type { ContractBudgetService } from "./contractBudget.service";
import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
} from "./errors";

/** Who the gateway resolved the caller to. Never read from the caller's body. */
export interface HostedCaller {
  virtualKeyId: string;
  organizationId: string;
  projectId: string | null;
}

/** One budget that applies to the caller, with its spend when that is known. */
export interface HostedBudgetUsage {
  id: string;
  scope: string;
  window: string;
  limitUsd: number;
  /** Null when live spend could not be read. Never zero in that case. */
  spentUsd: number | null;
  onBreach: "block" | "warn";
  periodStartedAt: Date;
  isContract: boolean;
}

export interface HostedUsageReader {
  read(caller: HostedCaller): Promise<{
    budgets: HostedBudgetUsage[];
    spendAvailable: boolean;
    readAt: Date;
  }>;
}

export interface HostedServicesDependencies {
  licenseOfKey: (virtualKeyId: string) => Promise<IssuedLicenseRecord | null>;
  classifier: () => InstantEvalClassifier;
  spend: { add(entry: ConnectSpendEntry): void };
  usage: HostedUsageReader;
  contractBudgets: Pick<ContractBudgetService, "setCap" | "termsOf">;
  now?: () => Date;
}

const MAX_QUESTIONS_PER_CALL = 50;

export const classifyPayloadSchema = z.object({
  text: z.string().min(1),
  questions: z
    .array(instantEvalQuestionSchema)
    .min(1)
    .max(MAX_QUESTIONS_PER_CALL),
});

export const budgetPayloadSchema = z.object({
  /** The new cap in USD, to the cent. */
  cap_usd: z.number().positive().finite(),
});

const INSTANT_EVALS = "instant_evals";

export class HostedServicesService {
  private readonly now: () => Date;

  constructor(private readonly deps: HostedServicesDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async classify({
    caller,
    payload,
    signal,
  }: {
    caller: HostedCaller;
    payload: unknown;
    signal?: AbortSignal;
  }) {
    const license = await this.activeLicenseOf(caller);
    if (!license?.services.includes(INSTANT_EVALS)) {
      throw new ConnectServiceNotEntitledError(INSTANT_EVALS);
    }
    const request = parse(classifyPayloadSchema, payload);
    const classifier = this.deps.classifier();
    // The rate share is per customer: the hidden project is one per
    // organization, and a key with none falls back to itself.
    const projectId = caller.projectId ?? caller.virtualKeyId;

    const judgement = await classifier.classify(
      { projectId, text: request.text, questions: request.questions },
      signal,
    );

    const costUsd = instantEvalCostUsd({
      inputTokens: judgement.inputTokens,
      pricing: classifier.pricing,
    });
    const priceUsd = instantEvalPriceUsd({
      costUsd,
      pricing: classifier.pricing,
    });
    // A skipped judgement billed no tokens, so there is nothing to meter.
    if (judgement.inputTokens > 0) {
      this.deps.spend.add({
        virtualKeyId: caller.virtualKeyId,
        projectId,
        inputTokens: judgement.inputTokens,
        costUsd,
        priceUsd,
      });
    }

    // The list price is what the customer is charged and all it is told.
    // What the judge costs LangWatch stays on the spend row.
    return {
      verdicts: judgement.verdicts,
      ...(judgement.skippedReason
        ? { skipped_reason: judgement.skippedReason }
        : {}),
      input_tokens: judgement.inputTokens,
      is_text_truncated: judgement.isTextTruncated,
      charged_usd: priceUsd,
    };
  }

  async usage({ caller }: { caller: HostedCaller }) {
    const [license, reading] = await Promise.all([
      this.activeLicenseOf(caller),
      this.deps.usage.read(caller),
    ]);
    const terms = license
      ? await this.deps.contractBudgets.termsOf(caller.organizationId)
      : null;
    const contract = reading.budgets.find((budget) => budget.isContract);

    return {
      services: terms?.services ?? [],
      spend_available: reading.spendAvailable,
      read_at: reading.readAt.toISOString(),
      contract:
        terms && contract
          ? {
              ...budgetWire(contract),
              commit_usd: terms.commitUsdCents / 100,
              maximum_cap_usd: terms.maximumUsdCents / 100,
              overage_enabled: terms.overageEnabled,
              term_ends_at: terms.termEndsAt?.toISOString() ?? null,
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
  }) {
    const license = await this.activeLicenseOf(caller);
    if (!license) throw new ConnectLicenseRequiredError();
    const { cap_usd } = parse(budgetPayloadSchema, payload);

    const { capUsdCents, maximumUsdCents } =
      await this.deps.contractBudgets.setCap({
        organizationId: caller.organizationId,
        capUsdCents: Math.round(cap_usd * 100),
      });
    return {
      cap_usd: capUsdCents / 100,
      maximum_cap_usd: maximumUsdCents / 100,
    };
  }

  /**
   * The license the calling key belongs to, or null for a virtual key. The
   * credential was checked when the gateway resolved it, but a gateway serves a
   * cached credential for minutes, so state is read again here.
   */
  private async activeLicenseOf(
    caller: HostedCaller,
  ): Promise<IssuedLicenseRecord | null> {
    const license = await this.deps.licenseOfKey(caller.virtualKeyId);
    if (!license || license.organizationId !== caller.organizationId) {
      return null;
    }
    return statusOfIssuedLicense(license, this.now()) === "active"
      ? license
      : null;
  }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw ValidationError.fromZodError(result.error);
  return result.data;
}

function budgetWire(budget: HostedBudgetUsage) {
  return {
    id: budget.id,
    scope: budget.scope,
    window: budget.window,
    on_breach: budget.onBreach,
    cap_usd: budget.limitUsd,
    spent_usd: budget.spentUsd,
    remaining_usd:
      budget.spentUsd === null
        ? null
        : Math.max(0, budget.limitUsd - budget.spentUsd),
    period_started_at: budget.periodStartedAt.toISOString(),
  };
}

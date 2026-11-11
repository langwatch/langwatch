/**
 * Prices one answered PII redaction model call and records it as a priced fact (ADR-201).
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  batchCharactersOf,
  PII_REDACTION_MODEL_FREE_FLAG,
} from "../rules/pii-redaction-model.rules.ts";
import {
  piiRedactionPriceNanoUsd,
  piiRedactionSpendFact,
} from "../rules/pii-redaction-spend.rules.ts";
import { ProjectLookupCacheService } from "./project-lookup-cache.service.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-spend");

type SpendLogger = { error(fields: Record<string, unknown>, message: string): void };

/** An organization's free-list entry is read once per minute, as its routing is. */
const FREE_LIST_TTL_MS = 60_000;

/** One call the model answered, as the model service saw it. */
export type PiiRedactionAnsweredCall = Readonly<{
  organizationId: string;
  projectId: string;
  texts: readonly string[];
  /** The record's trace and span, when it has them. */
  recordKey?: string | undefined;
  durationMs: number;
}>;

type PiiRedactionSpendDeps = Readonly<{
  featureFlags: FeatureFlagApi;
  recordSpendPriced: (fact: PiiRedactionSpendPricedEventData) => Promise<void>;
  log: SpendLogger;
  now: () => number;
}>;

export class PiiRedactionSpendService {
  static create(input: {
    featureFlags: FeatureFlagApi;
    recordSpendPriced: (fact: PiiRedactionSpendPricedEventData) => Promise<void>;
    log?: SpendLogger;
    now?: () => number;
  }): PiiRedactionSpendService {
    return new PiiRedactionSpendService({
      ...input,
      log: input.log ?? logger,
      now: input.now ?? (() => nowInstant().epochMilliseconds),
    });
  }

  /** Keyed by organization; the cache's keys are opaque. */
  readonly #free: ProjectLookupCacheService<boolean>;

  private constructor(private readonly deps: PiiRedactionSpendDeps) {
    this.#free = ProjectLookupCacheService.create<boolean>({
      ttlMs: FREE_LIST_TTL_MS,
      now: deps.now,
    });
  }

  /** Never throws: a call that cannot be billed is logged with its amounts, not failed. */
  async record(call: PiiRedactionAnsweredCall): Promise<void> {
    const free = await this.#isFree(call);
    const fact = piiRedactionSpendFact({ ...call, free, occurredAt: this.deps.now() });

    try {
      await this.deps.recordSpendPriced(fact);
    } catch (error) {
      this.deps.log.error(
        {
          organizationId: fact.organizationId,
          projectId: fact.projectId,
          requestId: fact.requestId,
          priceNanoUsd: fact.priceNanoUsd,
          errorName: error instanceof Error ? error.name : typeof error,
        },
        "PII redaction model call not billed: its priced fact could not be recorded",
      );
    }
  }

  /** A free list that cannot be read records the call at zero, never charging a free org. */
  async #isFree(call: PiiRedactionAnsweredCall): Promise<boolean> {
    try {
      return await this.#free.get(call.organizationId, () =>
        this.deps.featureFlags.isEnabled(PII_REDACTION_MODEL_FREE_FLAG, {
          kind: "organization",
          organizationId: call.organizationId,
        }),
      );
    } catch (error) {
      const characters = batchCharactersOf(call.texts);
      this.deps.log.error(
        {
          organizationId: call.organizationId,
          projectId: call.projectId,
          priceNanoUsd: piiRedactionPriceNanoUsd({ characters, free: false }),
          errorName: error instanceof Error ? error.name : typeof error,
        },
        "PII redaction free list could not be read: the call is recorded at zero",
      );
      return true;
    }
  }
}

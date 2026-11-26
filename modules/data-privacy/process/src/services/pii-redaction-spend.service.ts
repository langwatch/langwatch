/**
 * Prices one answered PII redaction model call and records it as a priced fact (ADR-201).
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { batchCharactersOf } from "../rules/pii-redaction-model.rules.ts";
import {
  piiRedactionPriceNanoUsd,
  piiRedactionSpendFact,
} from "../rules/pii-redaction-spend.rules.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-spend");

type SpendLogger = { error(fields: Record<string, unknown>, message: string): void };

/** One call the model answered, as the model service saw it. */
type PiiRedactionAnsweredCall = Readonly<{
  organizationId: string;
  projectId: string;
  texts: readonly string[];
  /** The record's trace and span, when it has them. */
  recordKey?: string | undefined;
  /** Each model call's duration (ADR-201 decision 6, ADR-207): our cost sums them. */
  callDurationsMs: readonly number[];
  /**
   * Whether its routing priced it: false for the free list and self-hosted. Decided when the
   * batch was routed, so no flag read after the call answered can change its price.
   */
  priced: boolean;
}>;

type PiiRedactionSpendDeps = Readonly<{
  /**
   * Keys the request id, so it is no hash of the text anyone can recompute. Absent only where
   * no model is named, which never answers a call; a call reaching here without it is not billed.
   */
  requestIdKey: Uint8Array | undefined;
  recordSpendPriced: (fact: PiiRedactionSpendPricedEventData) => Promise<void>;
  log: SpendLogger;
  now: () => number;
}>;

/** Records a call at the price its routing decided; it reads no flag of its own (ADR-201). */
export class PiiRedactionSpendService {
  static create(input: {
    requestIdKey: Uint8Array | undefined;
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

  private constructor(private readonly deps: PiiRedactionSpendDeps) {}

  /** Never throws: a call that cannot be billed is logged with its amounts, not failed. */
  async record(call: PiiRedactionAnsweredCall): Promise<void> {
    const key = this.deps.requestIdKey;
    if (key === void 0) {
      this.deps.log.error(
        {
          organizationId: call.organizationId,
          projectId: call.projectId,
          priceNanoUsd: piiRedactionPriceNanoUsd({
            characters: batchCharactersOf(call.texts),
            free: !call.priced,
          }),
        },
        "PII redaction model call not billed: no key pepper to derive its request id from",
      );
      return;
    }
    const fact = piiRedactionSpendFact({
      organizationId: call.organizationId,
      projectId: call.projectId,
      texts: call.texts,
      recordKey: call.recordKey,
      callDurationsMs: call.callDurationsMs,
      key,
      free: !call.priced,
      occurredAt: this.deps.now(),
    });

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
}

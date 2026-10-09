/**
 * Trace's side of the OTLP source policy (Q82, Alex 2026-10-06): it folds governance's
 * coding-assistant billing fact into its own row and builds the receiver policy from it.
 * Spec: specs/server/otlp-receiver-policy.feature
 */
import {
  buildIngestKeyReceiverPolicies,
  type CodingAssistantBillingRecordedEventData,
  type GovernanceOtlpPolicyInput,
  type GovernanceOtlpReceiverPolicies,
} from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  IngestSourceKey,
  TraceIngestSourceBillingRepository,
} from "../repositories/trace-ingest-source-billing.repository.ts";

/** How long one organization's answer for one source is reused, as main's policy service did. */
const BILLED_CACHE_TTL_MS = 30_000;

type TraceIngestSourceBillingOptions = Readonly<{
  repository: TraceIngestSourceBillingRepository;
  logger?: Pick<Logger, "warn">;
  now?: () => number;
}>;

export class TraceIngestSourceBillingService {
  static create(options: TraceIngestSourceBillingOptions): TraceIngestSourceBillingService {
    return new TraceIngestSourceBillingService(options);
  }

  readonly #repository: TraceIngestSourceBillingRepository;
  readonly #logger: Pick<Logger, "warn">;
  readonly #now: () => number;
  readonly #cache = new Map<string, { billed: boolean; expiresAt: number }>();

  private constructor(options: TraceIngestSourceBillingOptions) {
    this.#repository = options.repository;
    this.#logger = options.logger ?? createLogger("langwatch:trace:ingest-source-billing");
    this.#now = options.now ?? (() => nowInstant().epochMilliseconds);
  }

  /** Folds one governance fact; an older fact than the stored one changes nothing. */
  async fold(fact: CodingAssistantBillingRecordedEventData): Promise<void> {
    await this.#repository.recordIfNewer({
      organizationId: fact.organizationId,
      sourceType: fact.sourceType,
      billed: fact.billed,
      recordedAtMs: fact.recordedAtMs,
    });
  }

  /** The receiver policy for an ingestion-source key; never refuses (main's failure default). */
  async receiverPolicies(
    input: GovernanceOtlpPolicyInput,
  ): Promise<GovernanceOtlpReceiverPolicies> {
    const billed = await this.isBilled({
      organizationId: input.organizationId,
      sourceType: input.sourceType,
    });
    return buildIngestKeyReceiverPolicies(input, !billed);
  }

  /** Billed only while trace's row says so: an absent row or a failed read is not billed. */
  async isBilled(key: IngestSourceKey): Promise<boolean> {
    const cacheKey = `${key.organizationId}:${key.sourceType}`;
    const now = this.#now();
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.billed;

    let billed = false;
    try {
      billed = (await this.#repository.find(key))?.billed ?? false;
    } catch (error) {
      this.#logger.warn(
        { error, ...key },
        "ingest source billing read failed; treated as not billed",
      );
      return false;
    }
    this.#cache.set(cacheKey, { billed, expiresAt: now + BILLED_CACHE_TTL_MS });
    return billed;
  }
}

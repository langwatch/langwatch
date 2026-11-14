// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a push-mode IngestionSource payload becomes: origin metadata stamped
 * receiver-authoritatively, the existing trace / log / metric pipelines handed
 * the batch under the organization's hidden governance project, and the cost
 * events inside a log batch recorded as the facts the spend ledger debits.
 */
import {
  ingestedCostRecordedEventDataSchema,
  type CanonicalCostEvent,
  type GovernanceIngestionSource,
  type IngestedCostRecordedEventData,
  type RecordIngestedCostCommand,
} from "@langwatch/enterprise-governance-contract";
import { usdToNanoUsd } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { parseOtlpLogs } from "@langwatch/otlp";
import { nowInstant } from "@langwatch/time";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";

import type { GovernanceIngestReceiverMembers } from "./governance-ingest-receiver.service.ts";

const logger = createLogger("langwatch:ingest");

/** A log batch's cost events: extracted (through the source's OTTL rules) and debited to its budgets. */
export class GovernanceIngestCostService {
  private constructor(
    private readonly members: Pick<
      GovernanceIngestReceiverMembers,
      "costEvents" | "ottl" | "directory" | "costs"
    >,
  ) {}

  static create(
    members: Pick<GovernanceIngestReceiverMembers, "costEvents" | "ottl" | "directory" | "costs">,
  ): GovernanceIngestCostService {
    return new GovernanceIngestCostService(members);
  }

  /**
   * Cost-event extraction via OTTL. Any source carrying
   * `parserConfig.ottlStatements` uses the gateway transform; a transform
   * failure falls back to canonical extraction over the ORIGINAL payload, so a
   * rejected statement set is a configuration problem rather than lost events.
   */
  async extractCostEvents(input: {
    source: GovernanceIngestionSource;
    body: ArrayBuffer;
    contentType: string | undefined;
    parsed: IExportLogsServiceRequest;
  }): Promise<CanonicalCostEvent[]> {
    const { costEvents, ottl } = this.members;
    const { source } = input;
    const parserConfig = (source.parserConfig as Record<string, unknown> | null) ?? {};
    const ottlStatements = Array.isArray(parserConfig.ottlStatements)
      ? (parserConfig.ottlStatements as unknown[]).filter(
          (statement): statement is string =>
            typeof statement === "string" && statement.trim().length > 0,
        )
      : [];

    if (ottlStatements.length === 0) return [];

    const declaredType = (input.contentType ?? "").toLowerCase();
    const encoding: "json" | "proto" = declaredType.includes("json") ? "json" : "proto";

    try {
      const result = await ottl.transform({
        sourceId: source.id,
        kind: "log",
        encoding,
        payloadB64: Buffer.from(input.body).toString("base64"),
        statements: ottlStatements,
      });

      if (!result.ok) {
        logger.warn(
          {
            sourceId: source.id,
            errorCount: result.errors.length,
            firstError: result.errors[0]?.message,
          },
          "OTTL transform rejected statements at receive — falling back to un-mutated extraction",
        );

        return costEvents.extract(input.parsed);
      }

      const mutated = Buffer.from(result.payloadB64, "base64");
      const mutatedBytes = mutated.buffer.slice(
        mutated.byteOffset,
        mutated.byteOffset + mutated.byteLength,
      ) as ArrayBuffer;
      const reparsed = parseOtlpLogs(
        mutatedBytes,
        result.encoding === "json" ? "application/json" : "application/x-protobuf",
      );

      if (!reparsed.ok) {
        logger.warn(
          { sourceId: source.id, err: reparsed.error },
          "OTTL transform returned unparseable payload — falling back to un-mutated extraction",
        );

        return costEvents.extract(input.parsed);
      }

      return costEvents.extract(reparsed.request);
    } catch (transformErr) {
      logger.warn(
        { sourceId: source.id, err: String(transformErr) },
        "OTTL transform request failed — falling back to un-mutated extraction",
      );

      return costEvents.extract(input.parsed);
    }
  }

  /**
   * Each cost event priced and attributed into the fact gateway's ledger debits, recorded
   * through governance's command and never written to the ledger in the request. A failed
   * record rejects: the receiver answers 503 and the resend dedupes on source and request id.
   */
  async recordCostEvents(input: {
    events: readonly CanonicalCostEvent[];
    source: GovernanceIngestionSource;
    governanceProjectId: string;
  }): Promise<void> {
    const { events, source, governanceProjectId } = input;
    const observedAtMs = nowInstant().epochMilliseconds;
    const commands: RecordIngestedCostCommand[] = [];

    for (const event of events) {
      const data = await this.recordedFact({ event, source, observedAtMs });
      if (data)
        commands.push({ tenantId: governanceProjectId, occurredAt: data.occurredAtMs, data });
    }

    if (commands.length > 0) await this.members.costs.record(commands);
  }

  /**
   * One event's fact, or null for a cost the ledger cannot hold exactly: not a decimal amount,
   * or past a safe integer. Skipped with a log, since a resend carries the same value.
   */
  private async recordedFact({
    event,
    source,
    observedAtMs,
  }: {
    event: CanonicalCostEvent;
    source: GovernanceIngestionSource;
    observedAtMs: number;
  }): Promise<IngestedCostRecordedEventData | null> {
    // The reported cost is a decimal string, so it is pinned to an integer
    // once, here, and every total downstream adds those integers.
    let nano: bigint;
    try {
      nano = usdToNanoUsd(event.costUsd);
    } catch (error) {
      logger.error(
        { costUsd: event.costUsd, requestId: event.requestId, error },
        "budget: cost is not a decimal amount, skipping the cost fact",
      );
      return null;
    }
    const amountNanoUsd = Number(nano);

    if (!Number.isSafeInteger(amountNanoUsd)) {
      logger.error(
        { costUsd: event.costUsd, nanoUsd: nano.toString(), requestId: event.requestId },
        "budget: amountNanoUsd exceeds Number.MAX_SAFE_INTEGER, skipping the cost fact to avoid silent rounding",
      );
      return null;
    }

    const fact = ingestedCostRecordedEventDataSchema.safeParse({
      ingestionSourceId: source.id,
      sourceType: source.sourceType,
      organizationId: source.organizationId,
      teamId: source.teamId ?? null,
      requestId: event.requestId,
      model: event.model,
      tokensInput: tokenCount(event.inputTokens),
      tokensOutput: tokenCount(event.outputTokens),
      tokensCacheRead: tokenCount(event.cacheReadTokens),
      tokensCacheWrite: tokenCount(event.cacheCreationTokens),
      amountNanoUsd,
      principalUserId: await this.findPrincipal({ event, source }),
      occurredAtMs: this.occurredAtMs({ event, observedAtMs }),
      observedAtMs,
    });
    if (fact.success) return fact.data;

    logger.error(
      { requestId: event.requestId, issues: fact.error.issues },
      "budget: cost fact does not fit the recorded event, skipping it",
    );
    return null;
  }

  /** A record stamped at or before the epoch counts at receive time, as an absent stamp does. */
  private occurredAtMs({
    event,
    observedAtMs,
  }: {
    event: CanonicalCostEvent;
    observedAtMs: number;
  }): number {
    const occurredAtMs = event.occurredAt.epochMilliseconds;
    return occurredAtMs > 0 ? occurredAtMs : observedAtMs;
  }

  /**
   * Resolved by email, inside the source's organization only. An unknown
   * or non-member address attributes to nobody and the spend still rolls
   * up at organization, team and project scope.
   */
  private async findPrincipal({
    event,
    source,
  }: {
    event: CanonicalCostEvent;
    source: GovernanceIngestionSource;
  }): Promise<string | null> {
    if (!event.userEmail) return null;

    const principalUserId = await this.members.directory.findMemberIdByEmail({
      email: event.userEmail,
      organizationId: source.organizationId,
    });

    if (!principalUserId) {
      logger.info(
        {
          sourceId: source.id,
          userEmail: event.userEmail,
          anthropicAccountId: event.raw["user.account_id"],
          requestId: event.requestId,
        },
        "ingestion-source event from non-member email — falling back to org/team/project scope only",
      );
    }

    return principalUserId;
  }
}

/** A token count as the fact holds it: a whole, non-negative number; anything else counts as none. */
function tokenCount(value: number): number {
  const whole = Math.floor(value);
  return Number.isSafeInteger(whole) && whole > 0 ? whole : 0;
}

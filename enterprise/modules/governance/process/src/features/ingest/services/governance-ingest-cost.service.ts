// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a push-mode IngestionSource payload becomes: origin metadata stamped
 * receiver-authoritatively, the existing trace / log / metric pipelines handed
 * the batch under the organization's hidden governance project, and the cost
 * events inside a log batch recorded as the facts the spend ledger debits.
 */
import type {
  CanonicalCostEvent,
  GovernanceIngestionSource,
  IngestedCostRecordedEventData,
  RecordIngestedCostCommand,
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
  }): Promise<number> {
    const { events, source, governanceProjectId } = input;
    const observedAtMs = nowInstant().epochMilliseconds;
    const commands: RecordIngestedCostCommand[] = [];

    for (const event of events) {
      const data = await this.recordedFact({ event, source, governanceProjectId, observedAtMs });
      if (data)
        commands.push({ tenantId: governanceProjectId, occurredAt: data.occurredAtMs, data });
    }

    if (commands.length > 0) await this.members.costs.record(commands);

    return commands.length;
  }

  /** One event's fact, or null for an amount no ledger integer can hold without rounding. */
  private async recordedFact({
    event,
    source,
    governanceProjectId,
    observedAtMs,
  }: {
    event: CanonicalCostEvent;
    source: GovernanceIngestionSource;
    governanceProjectId: string;
    observedAtMs: number;
  }): Promise<IngestedCostRecordedEventData | null> {
    // The reported cost is a decimal string, so it is pinned to an integer
    // once, here, and every total downstream adds those integers.
    const nano = usdToNanoUsd(event.costUsd);
    const amountNanoUsd = Number(nano);

    if (!Number.isSafeInteger(amountNanoUsd)) {
      logger.error(
        { costUsd: event.costUsd, nanoUsd: nano.toString(), requestId: event.requestId },
        "budget: amountNanoUsd exceeds Number.MAX_SAFE_INTEGER, skipping debit row to avoid silent rounding",
      );
      return null;
    }

    return {
      ingestionSourceId: source.id,
      sourceType: source.sourceType,
      organizationId: source.organizationId,
      teamId: source.teamId ?? null,
      projectId: governanceProjectId,
      requestId: event.requestId,
      model: event.model,
      tokensInput: event.inputTokens,
      tokensOutput: event.outputTokens,
      tokensCacheRead: event.cacheReadTokens,
      tokensCacheWrite: event.cacheCreationTokens,
      amountNanoUsd,
      principalUserId: await this.findPrincipal({ event, source }),
      occurredAtMs: Math.max(1, event.occurredAt.epochMilliseconds),
      observedAtMs,
    };
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

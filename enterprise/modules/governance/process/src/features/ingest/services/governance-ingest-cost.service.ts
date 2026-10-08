// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a push-mode IngestionSource payload becomes: origin metadata stamped
 * receiver-authoritatively, the existing trace / log / metric pipelines handed
 * the batch under the organization's hidden governance project, and the cost
 * events inside a log batch priced into the spend ledger.
 */
import type {
  CanonicalCostEvent,
  GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";
import { usdToNanoUsd } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { parseOtlpLogs } from "@langwatch/otlp";
import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";

import type {
  GovernanceIngestReceiverMembers,
  GovernanceIngestSpend,
} from "./governance-ingest-receiver.service.ts";

const logger = createLogger("langwatch:ingest");

/** A log batch's cost events: extracted (through the source's OTTL rules) and debited to its budgets. */
export class GovernanceIngestCostService {
  private constructor(
    private readonly members: Pick<
      GovernanceIngestReceiverMembers,
      "costEvents" | "ottl" | "directory"
    >,
  ) {}

  static create(
    members: Pick<GovernanceIngestReceiverMembers, "costEvents" | "ottl" | "directory">,
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
   * One debit row per (event, applicable budget). Every failure here is
   * per-event and logged rather than fatal: the batch was already
   * acknowledged, and losing the rest of it because one event named an unknown
   * user would turn a partial attribution gap into total data loss.
   */
  async priceCostEvents(input: {
    events: readonly CanonicalCostEvent[];
    source: GovernanceIngestionSource;
    spend: GovernanceIngestSpend;
    governanceProjectId: string;
  }): Promise<number> {
    const { events, source, spend, governanceProjectId } = input;
    let ledgerRowsWritten = 0;

    for (const event of events) {
      try {
        ledgerRowsWritten += await this.debitEvent({ event, source, spend, governanceProjectId });
      } catch (eventErr) {
        logger.warn(
          { sourceId: source.id, requestId: event.requestId, err: String(eventErr) },
          "ingestion-source event ledger-write failed (continuing batch)",
        );
      }
    }

    return ledgerRowsWritten;
  }

  /** The debit rows for one event, against every budget it applies to; the count written. */
  private async debitEvent({
    event,
    source,
    spend,
    governanceProjectId,
  }: {
    event: CanonicalCostEvent;
    source: GovernanceIngestionSource;
    spend: GovernanceIngestSpend;
    governanceProjectId: string;
  }): Promise<number> {
    const principalUserId = await this.findPrincipal({ event, source });

    // Sentinel team and virtual-key ids for ingestion-source rows: the
    // applicable-scopes signature requires non-null strings, and a sentinel
    // that cannot be a real id naturally excludes the narrow TEAM budgets
    // while organization, project and principal budgets still match.
    const sentinelVK = `_ingestion_:${source.id}`;
    // Attributed-user templates bucket spend per END user and an ingestion
    // source carries none, so a row here could only name the bare anchor.
    const budgets = (
      await spend.resolveApplicableBudgets({
        organizationId: source.organizationId,
        teamId: source.teamId ?? `_ingestion_:${source.id}`,
        projectId: governanceProjectId,
        virtualKeyId: sentinelVK,
        principalUserId,
      })
    )
      .map(({ budget }) => budget)
      .filter((budget) => budget.scopeType !== "ATTRIBUTED_USER");

    if (budgets.length === 0) return 0;

    // The reported cost is a decimal string, so it is pinned to an integer
    // once, here, and every total downstream adds those integers.
    const nano = usdToNanoUsd(event.costUsd);
    const nanoNum = Number(nano);

    if (!Number.isSafeInteger(nanoNum)) {
      logger.error(
        { costUsd: event.costUsd, nanoUsd: nano.toString(), requestId: event.requestId },
        "budget: amountNanoUsd exceeds Number.MAX_SAFE_INTEGER, skipping debit row to avoid silent rounding",
      );
      return 0;
    }

    const rows = budgets.map((budget) => ({
      tenantId: governanceProjectId,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: budget.scopeId,
      window: budget.window,
      virtualKeyId: sentinelVK,
      gatewayRequestId: event.requestId,
      amountNanoUsd: nanoNum,
      tokensInput: event.inputTokens,
      tokensOutput: event.outputTokens,
      tokensCacheRead: event.cacheReadTokens,
      tokensCacheWrite: event.cacheCreationTokens,
      model: event.model,
      durationMs: 0,
      status: "SUCCESS" as const,
      occurredAt: event.occurredAt,
    }));

    await spend.insertSpendDebit(rows);
    await this.announceDebit({ event, source, spend, governanceProjectId, budgets });

    return rows.length;
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
    let principalUserId: string | null = null;

    if (event.userEmail) {
      principalUserId = await this.members.directory.findMemberIdByEmail({
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
    }

    return principalUserId;
  }

  private async announceDebit({
    event,
    source,
    spend,
    governanceProjectId,
    budgets,
  }: {
    event: CanonicalCostEvent;
    source: GovernanceIngestionSource;
    spend: GovernanceIngestSpend;
    governanceProjectId: string;
    budgets: readonly { id: string }[];
  }): Promise<void> {
    // A change event so the gateway's subscriber evicts its cache and the
    // next request re-resolves against the fresh spend. Its failure is
    // logged rather than raised: the row has already landed, and the cache
    // is corrected by the next change anyway.
    try {
      await spend.appendBudgetChange({
        organizationId: source.organizationId,
        projectId: governanceProjectId,
        payload: {
          source: "ingestion_source",
          sourceId: source.id,
          requestId: event.requestId,
          userEmail: event.userEmail,
          budgetIds: budgets.map((budget) => budget.id),
          amountUsd: event.costUsd,
        },
      });
    } catch (changeErr) {
      logger.warn(
        { sourceId: source.id, requestId: event.requestId, err: String(changeErr) },
        "BUDGET_UPDATED emit failed (ledger row already landed)",
      );
    }
  }
}

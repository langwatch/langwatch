import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { TraceLegacyReadClickHouseRepository } from "../../features/legacy/repositories/clickhouse/trace-legacy-read.repository.ts";
import { ClickHouseTraceAttributeSpendRepository } from "../clickhouse/clickhouse.trace-attribute-spend.repository.ts";
import { ClickHouseTraceAttributedRollupRepository } from "../clickhouse/clickhouse.trace-attributed-rollup.repository.ts";
import { ClickHouseTraceClusteringSampleRepository } from "../clickhouse/clickhouse.trace-clustering-sample.repository.ts";
import { ClickHouseTraceIndexMaterialisationRepository } from "../clickhouse/clickhouse.trace-index-materialisation.repository.ts";
import { MemberTraceClickHouseClientRepository } from "../clickhouse/clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceModelSpendRepository } from "../clickhouse/clickhouse.trace-model-spend.repository.ts";
import { LogRecordStorageClickHouseRepository } from "../clickhouse/log-record-storage.repository.ts";
import { SessionGroupsClickHouseRepository } from "../clickhouse/session-groups.repository.ts";
import { SpanStorageClickHouseRepository } from "../clickhouse/span-storage.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../clickhouse/trace-analytics-rollup.repository.ts";
import { TraceDerivationSpanClickHouseRepository } from "../clickhouse/trace-derivation-span.repository.ts";
import { ClickHouseTraceEvaluationRunsRepository } from "../clickhouse/trace-evaluation-runs.repository.ts";
import { ClickHouseTraceExistenceRepository } from "../clickhouse/trace-existence.repository.ts";
import { ClickHouseTraceInstantEvalRunsRepository } from "../clickhouse/trace-instant-eval-runs.repository.ts";
import { TraceListClickHouseRepository } from "../clickhouse/trace-list.repository.ts";
import { TraceAnalyticsClickHouseRepository } from "../clickhouse/trace-metrics-analytics.repository.ts";
import { ClickHouseTraceSpanRepository } from "../clickhouse/trace-span.repository.ts";
import {
  TraceSummaryClickHouseRepository,
  TraceSummaryProjectionClickHouseRepository,
} from "../clickhouse/trace-summary.repository.ts";
import { TraceUsageCountClickHouseRepository } from "../clickhouse/trace-usage-count.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";
import { PrismaTraceAnnotationScoresRepository } from "./prisma.trace-annotation-scores.repository.ts";
import { PrismaTraceAnnotationsRepository } from "./prisma.trace-annotations.repository.ts";
import { PrismaTraceEditOverlayRepository } from "./prisma.trace-edit-overlay.repository.ts";
import { PrismaTraceIngestSourceBillingRepository } from "./prisma.trace-ingest-source-billing.repository.ts";
import { PrismaTraceTopicNamesRepository } from "./prisma.trace-topic-names.repository.ts";

/**
 * Live tier for Postgres repositories. Writes carry their retention; the
 * platform default is data-retention's, asked through its peer by the stores.
 */
export class PostgresTraceRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      clickhouse: ClickHouseQueryClient;
    }>,
  ): Omit<
    TraceRepositories,
    | "summaryFoldCache"
    | "analyticsFoldCache"
    | "spanDedup"
    | "exportSlots"
    | "rateLimits"
    | "clickhouseClients"
    | "eventPayloads"
  > {
    const traceClickHouse = MemberTraceClickHouseClientRepository.resolverFor(members.clickhouse);
    const clickhouse = MemberTraceClickHouseClientRepository.authorizedFor(members.clickhouse);
    const storage = { resolveClient: traceClickHouse, clickhouse };
    const annotations = PrismaTraceAnnotationsRepository.create(members.prisma);
    const annotationScores = PrismaTraceAnnotationScoresRepository.create(members.prisma);

    return {
      editOverlay: PrismaTraceEditOverlayRepository.create(members.prisma),
      ingestSourceBilling: PrismaTraceIngestSourceBillingRepository.create({
        prisma: members.prisma,
      }),
      summaryProjection: TraceSummaryProjectionClickHouseRepository.create(storage),
      analyticsProjection: TraceAnalyticsClickHouseRepository.create(storage),
      analyticsRollup: TraceAnalyticsRollupClickHouseRepository.create({
        resolveClient: traceClickHouse,
      }),
      spanStorage: SpanStorageClickHouseRepository.create(storage),
      spanTree: ClickHouseTraceSpanRepository.create(storage),
      existence: ClickHouseTraceExistenceRepository.create({
        resolveClient: traceClickHouse,
      }),
      derivationSpans: TraceDerivationSpanClickHouseRepository.create({
        resolveClient: traceClickHouse,
      }),
      summary: TraceSummaryClickHouseRepository.create(storage),
      logRecords: LogRecordStorageClickHouseRepository.create(traceClickHouse),
      topicNames: PrismaTraceTopicNamesRepository.create(members.prisma),
      instantEvalRuns: ClickHouseTraceInstantEvalRunsRepository.create({
        resolveClient: traceClickHouse,
      }),
      evaluationRuns: ClickHouseTraceEvaluationRunsRepository.create(storage),
      annotations,
      annotationScores,
      legacyRead: TraceLegacyReadClickHouseRepository.create({
        resolveClickHouseClient: traceClickHouse,
        clickhouse,
        annotations: { rows: annotations, scores: annotationScores },
      }),
      list: TraceListClickHouseRepository.create({ clickhouse }),
      sessionGroups: SessionGroupsClickHouseRepository.create({ clickhouse }),
      clusteringSample: ClickHouseTraceClusteringSampleRepository.create({
        resolveClient: traceClickHouse,
      }),
      usageCount: TraceUsageCountClickHouseRepository.create(members.clickhouse),
      indexMaterialisation: ClickHouseTraceIndexMaterialisationRepository.create(
        members.clickhouse,
      ),
      modelSpend: ClickHouseTraceModelSpendRepository.create(members.clickhouse),
      attributeSpend: ClickHouseTraceAttributeSpendRepository.create(members.clickhouse),
      attributedRollup: ClickHouseTraceAttributedRollupRepository.create(members.clickhouse),
    };
  }
}

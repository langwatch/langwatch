import { AnnotationApi } from "@langwatch/annotation-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { LogApi } from "@langwatch/log-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import type { ClickHouseClient } from "@clickhouse/client";
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { TraceCanonicalisationService, TraceSummaryData } from "@langwatch/trace-contract";
import type { TraceBlobStoreService } from "../services/offload/trace-blob-store.service.ts";
import type { TraceLegacyFilterConditions } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import type { TraceProcessingCommands } from "../ports/trace-processing-installer.port.ts";
import type { TracesTrpcEmitters } from "./trace.app.ts";

export const traceDependencies = {
  annotations: AnnotationApi,
  authz: AuthzApi,
  codingAgents: CodingAgentApi,
  dataPrivacy: DataPrivacyApi,
  dataRetention: DataRetentionApi,
  plans: EntitlementApi,
  evaluations: EvaluationApi,
  logs: LogApi,
  modelProviders: ModelProviderApi,
  projects: ProjectApi,
  share: ShareApi,
  topics: TopicApi,
};

export type TraceInfrastructure = Readonly<{
  trace: Readonly<{
    resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
    defaultRetentionDays: number;
    canonicalisation: TraceCanonicalisationService;
    blobStore: TraceBlobStoreService;
    summaryStore: FoldProjectionStore<TraceSummaryData>;
    commands: TraceProcessingCommands;
    broadcast: TracesTrpcEmitters;
    filterConditions: TraceLegacyFilterConditions;
    fallbackVisibilityDays: number;
    processName: string;
  }>;
}>;

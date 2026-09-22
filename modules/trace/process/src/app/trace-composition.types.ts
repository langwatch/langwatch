import type { ClickHouseClient } from "@clickhouse/client";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FoldProjectionStore } from "@langwatch/eventing";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { LogApi } from "@langwatch/log-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { PresenceApi } from "@langwatch/presence-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { TopicApi } from "@langwatch/topic-contract";
import type { TraceCanonicalisationService, TraceSummaryData } from "@langwatch/trace-contract";

import type { TraceLegacyFilterConditions } from "../repositories/clickhouse/trace-legacy-read.repository.ts";
import type { TraceBlobStoreService } from "../services/trace-blob-store.service.ts";
import type { TracesTrpcEmitters } from "./trace.app.ts";
import type { TraceProcessingCommands } from "./trace.members.ts";

export const traceDependencies = {
  annotations: AnnotationApi,
  /**
   * The API-key directory the deprecated `/api/trace/*` family resolves its
   * own credential through — it opts out of the framework door because a
   * released SDK parses its pre-framework refusal bodies.
   */
  apiKeys: ApiKeyApi,
  authz: AuthzApi,
  codingAgents: CodingAgentApi,
  dataPrivacy: DataPrivacyApi,
  dataRetention: DataRetentionApi,
  plans: EntitlementApi,
  evaluations: EvaluationApi,
  instantEvals: InstantEvalApi,
  logs: LogApi,
  modelProviders: ModelProviderApi,
  presence: PresenceApi,
  projects: ProjectApi,
  share: ShareApi,
  storedObjects: StoredObjectApi,
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
    /** The deployment's public origin, for `platformUrl`. Optional: not every
     * install serves REST. */
    publicBaseUrl?: string;
  }>;
}>;

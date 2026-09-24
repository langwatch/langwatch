/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog, an explicit list of
 * models: a model is queryable only because it is named below.
 */

import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import {
  defineCatalogModel,
  type PostgresDatasetOverride,
} from "./lwql-postgres-catalog-model.rules.ts";
import { CONTENT_POSTGRES_OVERRIDES } from "./lwql-postgres-content-overrides.rules.ts";
import { CORE_POSTGRES_OVERRIDES } from "./lwql-postgres-core-overrides.rules.ts";
import { DESCRIPTIONS_POSTGRES_OVERRIDES } from "./lwql-postgres-descriptions-overrides.rules.ts";
import { PARENTS_POSTGRES_OVERRIDES } from "./lwql-postgres-parents-overrides.rules.ts";
import { SENSITIVE_POSTGRES_OVERRIDES } from "./lwql-postgres-sensitive-overrides.rules.ts";
import { TOPICS_POSTGRES_OVERRIDES } from "./lwql-postgres-topics-overrides.rules.ts";
import { VISIBILITY_POSTGRES_OVERRIDES } from "./lwql-postgres-visibility-overrides.rules.ts";

/** Combines two override maps model-by-model, not key-by-key. */
function mergePostgresOverride(
  base: PostgresDatasetOverride | undefined,
  addition: PostgresDatasetOverride,
): PostgresDatasetOverride {
  return {
    ...base,
    ...addition,
    aliases: { ...base?.aliases, ...addition.aliases },
    skipColumns: { ...base?.skipColumns, ...addition.skipColumns },
    columnGates: { ...base?.columnGates, ...addition.columnGates },
    columnUnits: { ...base?.columnUnits, ...addition.columnUnits },
    descriptions: { ...base?.descriptions, ...addition.descriptions },
    reAdmit: { ...base?.reAdmit, ...addition.reAdmit },
  };
}

/** Every override file's maps, merged model-by-model into the single map the builder reads. */
function mergePostgresOverrides(
  maps: readonly Readonly<Record<string, PostgresDatasetOverride>>[],
): Record<string, PostgresDatasetOverride> {
  const merged: Record<string, PostgresDatasetOverride> = {};
  for (const map of maps) {
    for (const [model, override] of Object.entries(map)) {
      merged[model] = mergePostgresOverride(merged[model], override);
    }
  }
  return merged;
}

export const LWQL_POSTGRES_ALL_OVERRIDES: Record<string, PostgresDatasetOverride> =
  mergePostgresOverrides([
    CORE_POSTGRES_OVERRIDES,
    TOPICS_POSTGRES_OVERRIDES,
    PARENTS_POSTGRES_OVERRIDES,
    CONTENT_POSTGRES_OVERRIDES,
    SENSITIVE_POSTGRES_OVERRIDES,
    VISIBILITY_POSTGRES_OVERRIDES,
    DESCRIPTIONS_POSTGRES_OVERRIDES,
  ]);

/** One opt-in Postgres catalog entry; the merged overrides resolve a `tenantVia` parent chain. */
function postgresView(model: string): LangWatchQLViewDefinition {
  return defineCatalogModel({
    model,
    override: LWQL_POSTGRES_ALL_OVERRIDES[model] ?? {},
    overrides: LWQL_POSTGRES_ALL_OVERRIDES,
  });
}

/** Every catalogued Prisma model, one explicit entry each, in exposed-view-name order. */
export const LWQL_POSTGRES_CATALOG: readonly LangWatchQLViewDefinition[] = [
  postgresView("Agent"),
  postgresView("AiToolEntry"),
  postgresView("AiToolEntryDepartment"),
  postgresView("AiToolEntryTeam"),
  postgresView("Analytics"),
  postgresView("AnnotationQueueItem"),
  postgresView("AnnotationQueueScores"),
  postgresView("AnnotationQueue"),
  postgresView("AnnotationScore"),
  postgresView("Annotation"),
  postgresView("AnomalyAlert"),
  postgresView("AnomalyRule"),
  postgresView("BatchEvaluation"),
  postgresView("Cost"),
  postgresView("CustomGraph"),
  postgresView("CustomLLMModelCost"),
  postgresView("Dashboard"),
  postgresView("DataPrivacyPolicy"),
  postgresView("DatasetRecord"),
  postgresView("Dataset"),
  postgresView("DepartmentMembershipHistory"),
  postgresView("Department"),
  postgresView("DiscoveredAgent"),
  postgresView("DiscoveredPerson"),
  postgresView("EmailSuppression"),
  postgresView("ErasedIdentifierSuppression"),
  postgresView("Evaluator"),
  postgresView("ExperimentVersion"),
  postgresView("Experiment"),
  postgresView("GatewayBudgetBucketBoundary"),
  postgresView("GatewayBudgetLedger"),
  postgresView("GatewayBudget"),
  postgresView("GatewayCacheRule"),
  postgresView("GatewayChangeEvent"),
  postgresView("GatewayGuardrail"),
  postgresView("GatewayRealtimeSession"),
  postgresView("GithubBranchPullRequestCheck"),
  postgresView("GithubInstallation"),
  postgresView("GithubPullRequest"),
  postgresView("GovernanceTenantHistory"),
  postgresView("IdentityMatchSuggestion"),
  postgresView("IdentityMatch"),
  postgresView("IngestionPullRunProjection"),
  postgresView("IngestionSource"),
  postgresView("IngestionTemplate"),
  postgresView("LangyActiveTurn"),
  postgresView("LangyConversationProjection"),
  postgresView("LangyConversationTurnProjection"),
  postgresView("LangyMessageProjection"),
  postgresView("LangyTurnRequest"),
  postgresView("ModelDefaultConfigScope"),
  postgresView("ModelDefaultConfig"),
  postgresView("ModelProviderScope"),
  postgresView("ModelProvider"),
  postgresView("Monitor"),
  postgresView("Notification"),
  postgresView("PinnedTrace"),
  postgresView("ProcessManagerInbox"),
  postgresView("ProcessManagerInstance"),
  postgresView("ProcessManagerOutboxAttempt"),
  postgresView("ProcessManagerOutbox"),
  postgresView("Project"),
  postgresView("PromptTagAssignment"),
  postgresView("PromptTag"),
  postgresView("LlmPromptConfigVersion"),
  postgresView("LlmPromptConfig"),
  postgresView("RetentionPolicy"),
  postgresView("RoutingPolicy"),
  postgresView("RoutingPolicyScope"),
  postgresView("SavedView"),
  postgresView("ScenarioVersion"),
  postgresView("Scenario"),
  postgresView("ScheduledJob"),
  postgresView("ShareLink"),
  postgresView("SimulationSuite"),
  postgresView("TopicClusteringRunHistoryProjection"),
  postgresView("TopicClusteringRunProjection"),
  postgresView("TopicModelProjection"),
  postgresView("Topic"),
  postgresView("TraceEditOverlay"),
  postgresView("TriggerSent"),
  postgresView("Trigger"),
  postgresView("VirtualKeyScope"),
  postgresView("VirtualKey"),
  postgresView("WebhookEndpointDelivery"),
  postgresView("WorkflowVersion"),
  postgresView("Workflow"),
  // Prisma models deliberately left out (absent = unqueryable) fall in four groups — no owning
  // tenant column, internal-only tenant, access-control plumbing, and permission-gated beyond
  // analytics:view; specs/lwql/catalog-inclusion.feature pins the list.
];

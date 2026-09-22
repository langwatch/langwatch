/**
 * The Prisma models the Postgres derived-view catalog exposes.
 *
 * The catalog is opt-*in*: {@link ./derivePostgresCatalog#derivePostgresCatalog}
 * turns a tenant-scoped model into a view only when the model is named here.
 * This list is the one and only way a model enters the catalog — a model not on
 * it is simply not queryable through LangWatchQL, and needs no entry anywhere
 * else to stay off. There is no skip list and no per-model reason string to
 * write: absence is the default, and inclusion is the deliberate act. See
 * {@link ../../../../../../dev/docs/adr/142-lwql-catalog-inclusion-is-opt-in.md}.
 *
 * The only remaining skip mechanism is column-level: an override's `skipColumns`
 * still strips individual columns from a view that is otherwise included. Whole
 * models are governed by presence on this list alone.
 *
 * `User`, `Team` and `Organization` — the identity scope itself — are not here,
 * and neither is any organization/admin-tier model (billing, audit, webhook
 * management) a project's `analytics:view` key must never read.
 *
 * A model named here whose Prisma model no longer exists fails the build
 * loudly: the derivation throws naming the entry, and
 * {@link ./__tests__/tenantModelCoverage.unit.test.ts} pins the count.
 *
 * @see ./derivePostgresCatalog.ts — what the include list turns into views
 * @see ./includedTables.ts — the ClickHouse half this mirrors
 */

/**
 * Every Prisma model the Postgres catalog derives, grouped by domain for
 * review. Order does not affect the output (the derivation filters the manifest
 * in manifest order); the grouping is only for a reader.
 */
export const LWQL_POSTGRES_INCLUDED_MODELS: readonly string[] = [
  // Projects and organization structure
  "Project",
  "Department",
  "DepartmentMembershipHistory",
  // Monitors and cost
  "Monitor",
  "Cost",
  // Topics and datasets
  "Topic",
  "Dataset",
  "DatasetRecord",
  // Dashboards, saved views and charts
  "Dashboard",
  "SavedView",
  "CustomGraph",
  // Batch evaluations
  "BatchEvaluation",
  // Triggers and webhook deliveries
  "Trigger",
  "WebhookEndpointDelivery",
  // Experiments
  "Experiment",
  "ExperimentVersion",
  // Annotations
  "Annotation",
  // Model providers and defaults
  "ModelProvider",
  "ModelProviderScope",
  "ModelDefaultConfig",
  "ModelDefaultConfigScope",
  // GitHub integration
  "GithubInstallation",
  "GithubPullRequest",
  "GithubBranchPullRequestCheck",
  // Langy conversations
  "LangyConversationProjection",
  "LangyTurnRequest",
  "LangyActiveTurn",
  "LangyConversationTurnProjection",
  "LangyMessageProjection",
  // Trigger sends and email suppression
  "TriggerSent",
  "EmailSuppression",
  // Annotation scoring and queues
  "AnnotationScore",
  "AnnotationQueue",
  "AnnotationQueueScores",
  "AnnotationQueueItem",
  // Sharing, pins and trace overlays
  "ShareLink",
  "PinnedTrace",
  "TraceEditOverlay",
  // Retention and data-privacy policies
  "RetentionPolicy",
  "DataPrivacyPolicy",
  // Custom model costs
  "CustomLLMModelCost",
  // Workflows and prompts
  "Workflow",
  "WorkflowVersion",
  "LlmPromptConfig",
  "LlmPromptConfigVersion",
  "PromptTagAssignment",
  "PromptTag",
  // Analytics and notifications
  "Analytics",
  "Notification",
  // Agents, evaluators, scenarios and simulations
  "Agent",
  "Evaluator",
  "Scenario",
  "ScenarioVersion",
  "SimulationSuite",
  // Gateway virtual keys and routing
  "VirtualKey",
  "VirtualKeyScope",
  "RoutingPolicy",
  "RoutingPolicyScope",
  "GatewayGuardrail",
  // Ingestion sources
  "IngestionSource",
  // Anomaly rules and alerts
  "AnomalyRule",
  "AnomalyAlert",
  // AI tool catalog
  "AiToolEntry",
  "AiToolEntryTeam",
  "AiToolEntryDepartment",
  // Ingestion templates
  "IngestionTemplate",
  // Gateway budgets, change events and cache
  "GatewayBudget",
  "GatewayBudgetBucketBoundary",
  "GatewayBudgetLedger",
  "GatewayChangeEvent",
  "GatewayCacheRule",
  // Process-manager substrate
  "ProcessManagerInstance",
  "ProcessManagerInbox",
  "ProcessManagerOutbox",
  "ProcessManagerOutboxAttempt",
  // Topic clustering runs and models
  "TopicClusteringRunProjection",
  "TopicModelProjection",
  "TopicClusteringRunHistoryProjection",
  // Ingestion pull runs
  "IngestionPullRunProjection",
  // Scheduled jobs
  "ScheduledJob",
  // Gateway realtime sessions
  "GatewayRealtimeSession",
  // Governance identity discovery
  "DiscoveredPerson",
  "DiscoveredAgent",
  "IdentityMatch",
  "GovernanceTenantHistory",
  "ErasedIdentifierSuppression",
  "IdentityMatchSuggestion",
];

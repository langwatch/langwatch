/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog, an
 * explicit list of models.
 *
 * ## Opt-in
 *
 * The Postgres half mirrors the ClickHouse half (`lwqlViews.ts`): the catalog
 * is an explicit list of {@link postgresView} entries, one per Prisma model,
 * and a model is queryable only because it is named below. There is no
 * derivation over the manifest and no skip list — a new tenant-scoped model
 * stays off the catalog, unqueryable and ungranted, until an entry is added
 * here. Each entry still reads that one model's columns and types from the
 * Prisma manifest, so the published schema cannot drift from the model.
 *
 * This module is the single assembly point: it feeds every override file into
 * {@link LWQL_POSTGRES_ALL_OVERRIDES} and lists every model. `lwqlViews.ts`
 * imports {@link LWQL_POSTGRES_CATALOG} to spread into `LWQL_VIEW_CATALOG`; the
 * six formerly-hand-written views are overrides in `./postgresOverrides/core.ts`.
 *
 * @see ./derivePostgresCatalog.ts — the per-model builder these entries call
 * @see ./postgresOverrides — per-model refinements to the safe defaults
 * @see specs/lwql/postgres-catalog.feature
 */

import {
  defineCatalogModel,
  type PostgresDatasetOverride,
} from "./derivePostgresCatalog";
import { CONTENT_POSTGRES_OVERRIDES } from "./postgresOverrides/content";
import { CORE_POSTGRES_OVERRIDES } from "./postgresOverrides/core";
import { DESCRIPTIONS_POSTGRES_OVERRIDES } from "./postgresOverrides/descriptions";
import { PARENTS_POSTGRES_OVERRIDES } from "./postgresOverrides/parents";
import { SENSITIVE_POSTGRES_OVERRIDES } from "./postgresOverrides/sensitive";
import { TOPICS_POSTGRES_OVERRIDES } from "./postgresOverrides/topics";
import { VISIBILITY_POSTGRES_OVERRIDES } from "./postgresOverrides/visibility";
import type { LangWatchQLViewDefinition } from "./types";

/**
 * Combines two override maps model-by-model, not key-by-key: a plain object
 * spread would let a later file's entry for a model silently replace an
 * earlier file's entry for that *same* model, dropping whichever record
 * fields (aliases, skipColumns, descriptions, ...) only the earlier one set.
 * `LangyConversationProjection` is exactly this case — `content.ts` gates its
 * `Title` column and `visibility.ts` restricts its rows, and both must hold.
 */
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

/** Every override file's maps, merged model-by-model into the single map the derivation reads. */
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

export const LWQL_POSTGRES_ALL_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = mergePostgresOverrides([
  CORE_POSTGRES_OVERRIDES,
  TOPICS_POSTGRES_OVERRIDES,
  PARENTS_POSTGRES_OVERRIDES,
  CONTENT_POSTGRES_OVERRIDES,
  SENSITIVE_POSTGRES_OVERRIDES,
  VISIBILITY_POSTGRES_OVERRIDES,
  DESCRIPTIONS_POSTGRES_OVERRIDES,
]);

/**
 * One Postgres catalog entry, opt-in: the model is queryable because this call
 * names it. Its refinements come from {@link LWQL_POSTGRES_ALL_OVERRIDES}, and
 * the same map is passed as context so a `tenantVia` parent chain resolves.
 */
function postgresView(model: string): LangWatchQLViewDefinition {
  return defineCatalogModel({
    model,
    override: LWQL_POSTGRES_ALL_OVERRIDES[model] ?? {},
    overrides: LWQL_POSTGRES_ALL_OVERRIDES,
  });
}

/**
 * Every catalogued Prisma model as a PostgreSQL-resident view — one explicit
 * {@link postgresView} entry per model, in exposed-view-name order. A model not
 * listed here is not in the catalog: there is no derivation over the manifest,
 * so a new Prisma model stays off until it is added below.
 */
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
  // Prisma models deliberately excluded (absent = unqueryable), grouped by reason:
  //   No owning tenant column:
  //     Account, AccountCredential, BugReport, ConnectedCreditGrant,
  //     ConnectedInvoice, ConnectedSeatChange, ConnectedStatement,
  //     FeatureFlag, IdempotencyReceipt, Identifier,
  //     IdentifierReservation, IdentityProjectionCursor, InstanceIdentity,
  //     MfaEnrollment, Passkey, ScimDirectoryUser, ScimExternalId,
  //     ScimUserResource, SelfHostedInstanceReport, Session,
  //     SignInAttemptLock, SsoAuthenticationActivity, TwoFactor, User,
  //     VerificationToken
  //   Internal-only tenant:
  //     SystemMigrationEnrollment, SystemMigrationTenantState
  //   Access-control plumbing:
  //     AnnotationQueueMembers, ApiKey, CustomRole, Grant, GrantUsage,
  //     Group, GroupMembership, JoinRequest, Organization,
  //     OrganizationInvite, OrganizationUser, PlatformToolPolicy,
  //     ProjectSecret, Role, RoleBinding, ScimRequestLog, ScimSyncState,
  //     ScimToken, SsoActivationRecoveryReservation, SsoBreakGlassBinding,
  //     SsoConnection, SsoConnectionRegistrationSlot,
  //     SsoConnectionReproofCursor, SsoCredential, SsoProvider,
  //     SsoVerifiedDomain, SsoVerifiedDomainHolder, Team, TeamUser
  //   Permission-gated (not analytics:view):
  //     ActivationCode, AuditLog, BillingMeterCheckpoint,
  //     ConnectedBillingAccount, Invoice, InvoiceItem, IssuedLicense,
  //     SelfHostedInstance, Subscription, WebhookEndpoint
];

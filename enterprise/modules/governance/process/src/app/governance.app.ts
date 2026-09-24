// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AuthApi, type CliAccessSession } from "@langwatch/auth-contract";
/**
 * The governance feature's application: what all three of its doors call.
 *
 * Governance answers over two transports today — a project-scoped REST family
 * (ingestion templates) and two tRPC surfaces (personal virtual keys, routing
 * policies) — and before this each door declared its own private bag. The two
 * tRPC files each wrote `Readonly<{ governance: GovernanceApi }>`, agreeing
 * by attention rather than by construction, and the REST family took its two
 * capabilities as separate resolver functions that neither tRPC door could
 * reach. One object now holds the union, so a rule written here is the rule
 * every door gets.
 *
 * What lives here as a method is what a door would otherwise have to know:
 *
 *   - resolving a project's organization, which the REST family did seven
 *     times inline;
 *   - attributing a write to its caller, including the `svc_<projectId>`
 *     fallback a legacy project token gets — four copies of one rule;
 *   - the organization-membership gate on every personal-virtual-key call, and
 *     the duplicate-label refusal;
 *   - turning the Governance contract's plain domain errors into handled ones
 *     with stable codes, so no transport constructs a transport error.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and the
 * CLI without knowing which it is serving.
 */
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  NoEligibleProvidersError,
  NoEligibleModelProvidersError,
  PersonalVirtualKeyLabelTakenError,
  PersonalVirtualKeyMissingError,
  PersonalVirtualKeyNotFoundError,
  RoutingPolicyHasNoProvidersError,
  RoutingPolicyEmptyError,
  RoutingPolicyModelNotConcreteError,
  RoutingPolicyProviderRequiredError,
  RoutingPolicyScopeRequiredError,
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  type CliBootstrapResult,
  type CreateRoutingPolicyInput,
  type DeleteRoutingPolicyInput,
  type Department,
  type FindRoutingPolicyInput,
  type GovernanceBudgetOverviewForUser,
  type GovernanceApi,
  type GovernanceCliBudgetStatusAnswer,
  type GovernanceCliBootstrapAnswer,
  type GovernanceCliBudgetOverviewAnswer,
  type GovernanceCliPersonalProjectAnswer,
  type GovernanceCliVirtualKeyAnswer,
  type GovernanceCliProjectKeyAnswer,
  type GovernanceCliIngestionSourcesAnswer,
  type GovernanceCliIngestionSourceEventsAnswer,
  type GovernanceCliIngestionSourceHealthAnswer,
  type GovernanceCliGovernanceStatusAnswer,
  type GovernanceCliIngestionTemplatesAnswer,
  type GovernanceCliIngestionKeyAnswer,
  type GovernanceCliIngestionKeysAnswer,
  type GovernanceCliIngestionKeyStateAnswer,
  type GovernanceCliKeyLookupRequest,
  type GovernanceCliRawRequest,
  type GovernanceCliRequest,
  type GovernanceCliSourceEventsRequest,
  type GovernanceCliSourceRequest,
  type GovernanceCliSourcesRequest,
  type GovernanceIngestOtlpInput,
  type GovernanceIngestResponse,
  type GovernanceIngestWebhookInput,
  type GovernanceProjectCaller,
  GovernanceRestApi,
  type IngestionTemplate,
  type IssuedPersonalVirtualKey,
  type ListPersonalVirtualKeysInput,
  type ListRoutingPoliciesInput,
  type GovernanceActorWorkspace,
  type PersonalVirtualKey,
  type PersonalUsageQueryInput,
  type PersonalUsageWindow,
  type RoutingPolicy,
  type SetDefaultRoutingPolicyInput,
  type UpdateRoutingPolicyInput,
  governanceSecrets,
} from "@langwatch/enterprise-governance-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import {
  OrganizationApi,
  type OrganizationService,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import { reads } from "@langwatch/process-stores/members";
import { PROJECT_KIND, ProjectApi } from "@langwatch/project-contract";
import { TraceApi } from "@langwatch/trace-contract";

import { governanceListingChannels } from "../channels/governance-listing-channels.registry.ts";
import { ClaudeComplianceReferencePullerAdapter } from "../channels/http/http.claude-compliance.channel.ts";
import { HttpCopilotStudioDataverseChannel } from "../channels/http/http.copilot-studio-dataverse.channel.ts";
import { HttpCopilotStudioChannel } from "../channels/http/http.copilot-studio.channel.ts";
import { HttpPollingPullerAdapter } from "../channels/http/http.polling.channel.ts";
import { IngestionPullProcess } from "../eventing/ingestion-pull.process.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { nextIngestionPullRunAt } from "../rules/ingestion-pull-schedule.rules.ts";
import { ratePulledUsage } from "../rules/pulled-usage-rate.rules.ts";
import { AgentDiscoveryService } from "../services/agent-discovery.service.ts";
import { AnthropicAdminPullerAdapter } from "../services/anthropic-admin-puller.service.ts";
import { DatabricksGeniePullerService } from "../services/databricks-genie-puller.service.ts";
import { DepartmentService } from "../services/department.service.ts";
import { ErasureSuppressionService } from "../services/erasure-suppression.service.ts";
import {
  GovernanceCliAccessService,
  type GovernanceCliAccessApi,
  type GovernanceCliMemberDirectory,
} from "../services/governance-cli-access.service.ts";
import {
  GovernanceCliActivityService,
  type GovernanceCliActivityApi,
} from "../services/governance-cli-activity.service.ts";
import {
  GovernanceCliCredentialService,
  type GovernanceCliBudgetReader,
  type GovernanceCliCredentialApi,
  type GovernanceCliPersonDirectory,
} from "../services/governance-cli-credentials.service.ts";
import { GovernanceCliService } from "../services/governance-cli.service.ts";
import { GovernanceIngestAccessService } from "../services/governance-ingest-access.service.ts";
import type { GovernanceIngestRateLimiter } from "../services/governance-ingest-rate-limit.service.ts";
import {
  GovernanceIngestReceiverService,
  type GovernanceIngestLogCollectionChannel,
  type GovernanceIngestMetricCollectionChannel,
  type GovernanceIngestPrincipalDirectory,
  type GovernanceIngestSpend,
  type GovernanceIngestTraceCollection,
} from "../services/governance-ingest-receiver.service.ts";
import { GovernanceIngestService } from "../services/governance-ingest.service.ts";
import { IdentityMatchSuggestionService } from "../services/identity-match-suggestion.service.ts";
import { IdentityMatchService } from "../services/identity-match.service.ts";
import { IngestionCredentialsService } from "../services/ingestion-credentials.service.ts";
import {
  IngestionPullEventingAdapter,
  type IngestionPullDefinition,
} from "../services/ingestion-pull-eventing.service.ts";
import { IngestionPullLifecycleService } from "../services/ingestion-pull-lifecycle.service.ts";
import { IngestionPullListingService } from "../services/ingestion-pull-listing.service.ts";
import { IngestionPullLogService } from "../services/ingestion-pull-log.service.ts";
import { IngestionPullMetricsService } from "../services/ingestion-pull-metrics.service.ts";
import { IngestionPullWorkerService } from "../services/ingestion-pull-worker.service.ts";
import { IngestionPullService } from "../services/ingestion-pull.service.ts";
import { IngestionTemplateService } from "../services/ingestion-template.service.ts";
import { OpenAiAdminPullerAdapter } from "../services/openai-admin-puller.service.ts";
import { OpenAiComplianceReferencePullerService } from "../services/openai-compliance-puller.service.ts";
import type { OrganizationSupportContactService } from "../services/organization-support-contact.service.ts";
import { PersonDiscoveryService } from "../services/person-discovery.service.ts";
import { PersonListingService } from "../services/person-listing.service.ts";
import {
  PersonalUsageDashboardService,
  type PersonalUsageRollup,
} from "../services/personal-usage-dashboard.service.ts";
import { PulledUsagePricingService } from "../services/pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../services/pulled-usage-record.service.ts";
import { PullerRegistryService } from "../services/puller-registry.service.ts";
import { S3PollingPullerService } from "../services/s3-puller.service.ts";
import { SourceCredentialAccessService } from "../services/source-credential-access.service.ts";
import { ssrfSafeFetch } from "../services/ssrf-safe-fetch.ts";
import { SuppressionSnapshotService } from "../services/suppression-snapshot.service.ts";
import {
  createGovernanceMemberInfrastructure,
  type GovernanceMemberDatabase,
} from "./governance-member-infrastructure.ts";
import type {
  GovernanceEncryptor,
  GovernanceHttpClient,
  PulledUsageDispatcher,
  GovernanceProjectDirectory,
} from "./governance.members.ts";

/**
 * The two questions personal virtual keys ask of the process's database.
 *
 * They are ports rather than service calls because both are single-row
 * existence checks the Governance service does not own: one reads organization
 * membership, the other the virtual-key uniqueness tuple.
 */
type EventingSenders = Readonly<Record<string, EventingCommandSender<unknown>>>;

export interface GovernancePersonalVirtualKeyMembers {
  /** Whether the caller belongs to this organization at all. */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;
  /** Whether this user already has an unrevoked personal key under this label. */
  hasActivePersonalKeyLabelled(input: {
    organizationId: string;
    userId: string;
    label: string;
  }): Promise<boolean>;
}

/**
 * The user an actor token names.
 *
 * A port rather than a service call because the token is whatever the span
 * carried as `langwatch.user_id` — an email address on most SDKs, occasionally
 * the User id itself — and matching either against the process's user table is
 * a single-row lookup the Governance service does not own.
 */
export interface GovernanceActorDirectory {
  findUser(input: { token: string }): Promise<GovernanceActorUser | null>;
}

/** The identity columns an actor drill-in reads. */
export interface GovernanceActorUser {
  id: string;
  name: string | null;
  email: string | null;
}

/** Where an actor's own workspace lives, for the admin's drill-in link. */
/**
 * What the `/api/auth/cli` governance plane reads that this feature does not
 * own: the device session a bearer names, the seat behind it, the plan it is
 * admitted against, and the identity and contact reads its credential routes
 * perform.
 */
export interface GovernanceCliMembers {
  /** Whether a caller still holds a seat in the token's organization. */
  members: GovernanceCliMemberDirectory;
  /** The identity and project reads the credential routes perform. */
  persons: GovernanceCliPersonDirectory;
  /** Who to point a caller at when a budget refuses the request. */
  supportContacts: Pick<OrganizationSupportContactService, "findSupportContact">;
  /** The spend decision the budget pre-flight asks, where one is composed. */
  budgets?: GovernanceCliBudgetReader | undefined;
  /** The deployment's public origin; the links this family answers use it. */
  publicBaseUrl?: string | undefined;
}

/**
 * What the push-mode `/api/ingest` receivers reach: the tenant every payload
 * lands under, the pipelines each signal is folded into, and the throttle the
 * gate applies before a byte is read. Only the trace pipeline is required —
 * a signal this deployment folds nowhere answers `not-served` rather than
 * pretending to accept it.
 */
export interface GovernanceIngestMembers {
  /** The hidden per-organization governance project every receiver writes under. */
  projects: Pick<GovernanceProjectDirectory, "ensureInternal">;
  /** Who a cost event's actor email names, where they are a member. */
  principals: GovernanceIngestPrincipalDirectory;
  /** The trace pipeline. Required — without it there is no receiver at all. */
  traceCollection: GovernanceIngestTraceCollection;
  /** The log pipeline, where this process folds logs. */
  logCollection?: GovernanceIngestLogCollectionChannel | undefined;
  /** The metric pipeline, where this process folds metrics. */
  metricCollection?: GovernanceIngestMetricCollectionChannel | undefined;
  /** The spend ledger a cost event is priced into, where one is composed. */
  spend?: GovernanceIngestSpend | undefined;
  /** The per-caller throttle, where this deployment composed a counter. */
  rateLimit?: GovernanceIngestRateLimiter | undefined;
}

/**
 * What this application is assembled from, once its three peers have been
 * resolved from {@link GovernanceApp.dependencies} and merged with the
 * bespoke members: the private view the constructor holds, not the shape a
 * process supplies.
 */
export interface GovernanceAppDependencies {
  /**
   * The ~100-operation governance facade, and the CLI/ingest collaborators
   * behind it. Optional because nothing constructs
   * `createGovernanceInstallation` today — no `GovernanceInstallationOptions`
   * is assembled anywhere a process boots — so a process that installs this
   * app supplies none of the three. Every method that reads one of them (the
   * CLI/ingest accessors, and the personal-virtual-key, routing-policy and
   * CLI-bootstrap operations the REST family does not call) throws a plain
   * error if it is ever reached before a process actually supplies it; the
   * seven ingestion-template and two department operations this REST family
   * serves read none of the three.
   */
  governance?: GovernanceApi;
  /**
   * The organization a project belongs to, for the project-scoped REST family,
   * and the organization's hidden governance project, which is the tenant an
   * ingestion source's usage rows land in.
   */
  projects: Pick<
    ProjectApi,
    "getOrganizationId" | "findInternal" | "findWithTeam" | "ensureInternal"
  >;
  /** The release flag that decides whether an organization's pulled usage carries a cost. */
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  /** Where a pulled Genie/Copilot conversation lands as a trace: the OTLP door main routed through. */
  traces: Pick<TraceApi, "otlpTraces">;
  /** Auth owns CLI bearer validation and revocation. */
  auth: Pick<AuthApi, "findCliAccessSession" | "revokeCliAccessToken">;
  /** Entitlements resolve the actual caller organization, never a deployment-global plan. */
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  /**
   * The member's personal workspace: created on demand when they mint their
   * first key, read as it stands when they open their own dashboard.
   */
  organizations: Pick<OrganizationService, "ensurePersonalWorkspace" | "getPersonalWorkspace"> &
    Pick<OrganizationApi, "findMembersIncludingDeactivated">;
  /** The SSO directory's external ids, which the identity match reads as proof. */
  scim: Pick<ScimApi, "findDirectoryExternalIds">;
  /**
   * The process's permission engine. Read directly rather than through a port
   * because the one question this feature asks it — may the caller see somebody
   * else's personal keys — is a plain decision at the organization scope.
   */
  permissions: Pick<AuthzService, "getDecision">;
  personalVirtualKeys: GovernancePersonalVirtualKeyMembers;
  /** Resolves the actor token stamped on a span to the person who owns it. */
  actors: GovernanceActorDirectory;
  /**
   * What the CLI governance plane reaches beyond this feature. Optional for
   * the same reason as {@link governance} — supplied only alongside it.
   */
  cli?: GovernanceCliMembers;
  /**
   * What the push-mode ingestion receivers reach beyond this feature.
   * Optional for the same reason as {@link governance} — supplied only
   * alongside it.
   */
  ingest?: GovernanceIngestMembers;
}

/** Who a call is attributed to, and (for a lazy backfill) what to name them. */
export interface GovernanceCaller {
  readonly id: string;
  readonly displayName?: string | null;
  readonly displayEmail?: string | null;
}

/**
 * What a process cannot hand this application from a peer's API: the
 * governance capability itself and the four bespoke directories behind it.
 *
 * Every one of these is a conversion debt with a named destination — the
 * capability becomes what this app IS rather than something injected into it,
 * the two personal-virtual-key checks and the actor lookup become repository
 * reads, and the CLI and ingest bags split into peers, channels and config.
 * Until then they travel beside the process's own members the way
 * `ScimBespokeMembers` does, so that what is genuinely unfinished is visible
 * in the type rather than hidden inside one undifferentiated bag.
 *
 * `governance`, `cli` and `ingest` stay three separate keys here rather than
 * folding into one grouped optional slot: `buildAppWithUnfinishedCapability`
 * in `app/__tests__/governance.app.unit.test.ts` builds this application by
 * naming them at this same top level, and a grouped slot would turn that into
 * an excess-property error. Each is independently optional instead, for the
 * one reason given on {@link GovernanceAppDependencies.governance}.
 */
export type GovernanceBespokeMembers = Omit<
  GovernanceAppDependencies,
  "projects" | "organizations" | "permissions" | "scim"
>;

/**
 * How a process installs this application: three peers, its own Prisma read,
 * and the still-unfinished governance/cli/ingest bag (see
 * {@link GovernanceAppDependencies.governance}) — untouched by the
 * personalVirtualKeys/actors conversion below.
 */
type GovernanceSetup = Readonly<{
  dependencies: FeatureSetup<typeof GovernanceApp.dependencies, never, undefined>["dependencies"];
  config: undefined;
  resources: FeatureSetup<typeof GovernanceApp.dependencies, never, undefined>["resources"];
  secrets: FeatureSetup<typeof GovernanceApp.dependencies, never, undefined>["secrets"];
  members: Readonly<{ prisma: GovernanceMemberDatabase; encryption: GovernanceEncryptor }> &
    Pick<GovernanceBespokeMembers, "governance" | "cli" | "ingest">;
  repositories: GovernanceRepositories;
}>;

export class GovernanceApp implements GovernanceRestApi {
  static readonly contract: typeof GovernanceRestApi = GovernanceRestApi;
  static readonly reads = reads("prisma", "encryption");
  /**
   * The peer modules this application reads. A peer is never a member:
   * the process resolves each token and hands the app the peer's own API, so
   * governance names what it needs rather than being handed a narrowed copy
   * whichever composition root happened to build it.
   */
  static readonly dependencies = {
    projects: ProjectApi,
    auth: AuthApi,
    entitlements: EntitlementApi,
    organizations: OrganizationApi,
    permissions: AuthzApi,
    scim: ScimApi,
    featureFlags: FeatureFlagApi,
    traces: TraceApi,
  };
  static readonly secrets = governanceSecrets;

  static async create({
    members,
    dependencies,
    repositories,
    secrets,
  }: GovernanceSetup): Promise<GovernanceApp> {
    const { personalVirtualKeys, actors } = createGovernanceMemberInfrastructure(members.prisma);
    const erasureSuppression = await secrets.into(
      governanceSecrets.erasurePseudonymSecret,
      (erasureSecret) =>
        ErasureSuppressionService.create({
          suppressions: repositories.erasedIdentifierSuppressions,
          tenantHistory: repositories.tenantHistory,
          erasureSecret,
        }),
    );
    return new GovernanceApp({
      dependencies: {
        personalVirtualKeys,
        actors,
        governance: members.governance,
        cli: members.cli,
        ingest: members.ingest,
        projects: dependencies.projects,
        auth: dependencies.auth,
        entitlements: dependencies.entitlements,
        organizations: dependencies.organizations,
        permissions: dependencies.permissions,
        scim: dependencies.scim,
        featureFlags: dependencies.featureFlags,
        traces: dependencies.traces,
      },
      repositories,
      erasureSuppression,
      encryption: members.encryption,
    });
  }

  private constructor({
    dependencies,
    repositories,
    erasureSuppression,
    encryption,
  }: {
    dependencies: GovernanceAppDependencies;
    repositories: GovernanceRepositories;
    erasureSuppression: ErasureSuppressionService;
    encryption: GovernanceEncryptor;
  }) {
    this.dependencies = dependencies;
    this.repositories = repositories;
    this.encryption = encryption;
    this.departments = DepartmentService.create({ repository: repositories.departments });
    this.erasureSuppression = erasureSuppression;
    // One instance: the erasure refreshes the very snapshot the cost fold reads (ADR-128 §9 step 5).
    this.suppressionSnapshot = SuppressionSnapshotService.create({
      load: () => erasureSuppression.loadSnapshot(),
    });
    this.identityMatches = IdentityMatchService.create({
      discoveredPeople: repositories.discoveredPeople,
      matches: repositories.identityMatches,
      suggestions: repositories.identityMatchSuggestions,
      organizations: dependencies.organizations,
      directory: dependencies.scim,
    });
    this.identityMatchSuggestions = IdentityMatchSuggestionService.create({
      discoveredPeople: repositories.discoveredPeople,
      matches: repositories.identityMatches,
      suggestions: repositories.identityMatchSuggestions,
      organizations: dependencies.organizations,
    });
    this.templates = IngestionTemplateService.create({
      repository: repositories.ingestionTemplates,
    });
    // Stored credentials seal under the process's CREDENTIALS_SECRET, the key main sealed them with.
    const sourceCredentials = SourceCredentialAccessService.create({
      sources: repositories.ingestionSources,
      credentials: IngestionCredentialsService.create(encryption),
    });
    const http: GovernanceHttpClient = { fetch: ssrfSafeFetch };
    this.http = http;
    const channels = governanceListingChannels.live;
    const signIn = channels.providerSignIn.create({ http });
    this.agentDiscovery = AgentDiscoveryService.create({
      agents: repositories.discoveredAgents,
      sourceCredentials,
      signIn,
      genieSpaces: channels.genieSpaces.create({ http }),
      copilotBots: channels.copilotBots.create({ http }),
    });
    this.personListing = PersonListingService.create({
      sourceCredentials,
      suppression: erasureSuppression,
      discovery: PersonDiscoveryService.create({ people: repositories.discoveredPeople }),
      signIn,
      adminApiUsers: channels.adminApiUsers.create({ http }),
      microsoftDirectory: channels.microsoftDirectory.create({ http }),
      databricksScimUsers: channels.databricksScimUsers.create({ http }),
    });

    // In a real deployment all three arrive together, from the one call that
    // builds the facade (`createGovernanceInstallation`) — never singly. No
    // process makes that call today, so every service below stays unbuilt
    // and its accessor throws if a CLI/ingest transport or a personal-key/
    // routing-policy tRPC operation ever reaches it.
    const { governance, cli, ingest } = dependencies;
    if (governance && cli && ingest) {
      this.personalUsageDashboards = PersonalUsageDashboardService.create({
        governance,
        organizations: dependencies.organizations,
        projects: dependencies.projects,
      });
      this.cliAccessService = GovernanceCliAccessService.create({
        accessTokens: cliAccessTokens(dependencies.auth),
        directory: () => cli.members,
        plans: () => dependencies.entitlements,
        permittedOnOrganization: (input) =>
          this.permittedOn("organization", input.organizationId, input),
        publicBaseUrl: cli.publicBaseUrl,
      });
      this.cliCredentialService = GovernanceCliCredentialService.create({
        governance: () => governance,
        directory: () => cli.persons,
        supportContacts: () => cli.supportContacts,
        ensurePersonalWorkspace: (input) =>
          dependencies.organizations.ensurePersonalWorkspace(input),
        getPersonalWorkspace: (input) => dependencies.organizations.getPersonalWorkspace(input),
        permittedOnProject: (input) => this.permittedOn("project", input.projectId, input),
        budgets: cli.budgets,
        publicBaseUrl: cli.publicBaseUrl,
      });
      this.cliActivityService = GovernanceCliActivityService.create({
        governance: () => governance,
      });
      this.cliService = GovernanceCliService.create({
        access: this.cliAccessService,
        credentials: this.cliCredentialService,
        activity: this.cliActivityService,
        governance,
      });
      const ingestAccess = GovernanceIngestAccessService.create({
        governance: () => governance,
        rateLimit: ingest.rateLimit,
      });
      const ingestReceiver = GovernanceIngestReceiverService.create({
        governance: () => governance,
        projects: () => ingest.projects,
        directory: () => ingest.principals,
        traceCollection: ingest.traceCollection,
        logCollection: ingest.logCollection,
        metricCollection: ingest.metricCollection,
        spend: ingest.spend,
      });
      this.ingestService = GovernanceIngestService.create({
        access: ingestAccess,
        receiver: ingestReceiver,
      });
    }
  }

  private readonly dependencies: GovernanceAppDependencies;
  private readonly departments: DepartmentService;
  private readonly agentDiscovery: AgentDiscoveryService;
  private readonly personListing: PersonListingService;
  private readonly templates: IngestionTemplateService;
  private readonly erasureSuppression: ErasureSuppressionService;
  private readonly suppressionSnapshot: SuppressionSnapshotService;
  private readonly identityMatches: IdentityMatchService;
  private readonly identityMatchSuggestions: IdentityMatchSuggestionService;
  private readonly repositories: GovernanceRepositories;
  private readonly encryption: GovernanceEncryptor;
  private readonly http: GovernanceHttpClient;
  private ingestionPullCommands: EventingSenders | undefined;
  private pulledUsageCommands: EventingSenders | undefined;
  private readonly personalUsageDashboards?: PersonalUsageDashboardService;
  private readonly cliAccessService?: GovernanceCliAccessApi;
  private readonly cliCredentialService?: GovernanceCliCredentialApi;
  private readonly cliActivityService?: GovernanceCliActivityApi;
  private readonly cliService?: GovernanceCliService;
  private readonly ingestService?: GovernanceIngestService;

  /**
   * Every accessor below resolves to the ~100-operation governance facade
   * (see the comment on {@link GovernanceAppDependencies.governance}), which
   * no process builds yet. Its callers all sit behind the CLI/ingest
   * transports this module drops from its boot graph, or a tRPC surface no
   * composition root mounts — so this throw is unreachable in practice, and
   * honest about why on the day it stops being unreachable.
   */
  private unfinishedCapability(): never {
    throw new Error("governance: this capability is not installed on this app");
  }

  /** The governance facade, or a throw naming why it is absent. */
  private get governanceApi(): GovernanceApi {
    return this.dependencies.governance ?? this.unfinishedCapability();
  }

  /**
   * One permission question at one scope. Both CLI families ask it — the gate
   * at organization tier, the credential routes at project tier — and asking
   * it here is what keeps the deployment's AuthZ graph a single member rather
   * than a function each service is handed separately.
   */
  private async permittedOn(
    tier: "organization" | "project",
    id: string,
    input: { userId: string; permission: AuthzPermission },
  ): Promise<boolean> {
    const { permitted } = await this.dependencies.permissions.getDecision({
      userId: input.userId,
      permission: input.permission,
      scope: { tier, id },
    });

    return permitted;
  }

  // ── The CLI governance plane ──────────────────────────────────────────────

  /** The bearer, the plan and the RBAC permission, in that order. */
  /** ingestion_pull_processing for this role: the worker also hosts main's pull process manager. */
  ingestionPullPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): IngestionPullDefinition {
    const runStatusStore = this.repositories.ingestionPullRuns;
    if (participation === "produce") {
      return IngestionPullEventingAdapter.create({ runStatusStore }).build();
    }
    return IngestionPullEventingAdapter.create({
      runStatusStore,
      process: this.ingestionPullProcess(),
    }).build();
  }

  connectIngestionPull(commands: EventingSenders): void {
    this.ingestionPullCommands = commands;
  }

  /** Main's boot reconciliation (`pipelineSet.ts:132-150`): every source's schedule sent to its pull process. */
  reconcileIngestionPulls(): Promise<{ reconciled: number; failed: number }> {
    const { projects } = this.dependencies;
    return IngestionPullLifecycleService.create({
      repository: this.repositories.ingestionPullLifecycle,
      tenant: {
        resolveTenantId: async (organizationId) =>
          (
            await projects.ensureInternal({
              organizationId,
              kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
            })
          ).id,
      },
      commands: {
        configure: (input) => this.ingestionPullSender("configure").send(input),
        disable: (input) => this.ingestionPullSender("disable").send(input),
      },
    }).reconcile();
  }

  connectPulledUsage(commands: EventingSenders): void {
    this.pulledUsageCommands = commands;
  }

  private ingestionPullSender(name: string) {
    const sender = this.ingestionPullCommands?.[name];
    if (!sender) throw new Error(`ingestion_pull_processing is not registered for ${name}`);
    return sender;
  }

  private pulledUsageSender(name: string) {
    const sender = this.pulledUsageCommands?.[name];
    if (!sender) throw new Error(`pulled_usage_processing is not registered for ${name}`);
    return sender;
  }

  /** Main's `pipelineSet.ts:76-130`: the runner, its outcome senders late-bound, and the listings. */
  private ingestionPullProcess(): IngestionPullProcess {
    const { repositories, http, dependencies } = this;
    const diagnostics = IngestionPullLogService.create();
    const objects = governanceListingChannels.live.objectStore.create();
    const pullers = PullerRegistryService.create();
    pullers.register(HttpPollingPullerAdapter.create({ http, diagnostics }));
    pullers.register(S3PollingPullerService.create({ objects, diagnostics }));
    pullers.register(HttpCopilotStudioChannel.create({ http }));
    pullers.register(HttpCopilotStudioDataverseChannel.create(http));
    pullers.register(OpenAiComplianceReferencePullerService.create({ objects, diagnostics }));
    pullers.register(OpenAiAdminPullerAdapter.create(http));
    pullers.register(ClaudeComplianceReferencePullerAdapter.create({ http, diagnostics }));
    pullers.register(AnthropicAdminPullerAdapter.create(http));
    pullers.register(DatabricksGeniePullerService.create(http));
    const worker = IngestionPullWorkerService.create({
      sources: repositories.ingestionSources,
      registry: pullers,
      credentials: IngestionCredentialsService.create(this.encryption),
      projects: dependencies.projects,
      sink: repositories.ocsfEvents,
      usageEntitlement: {
        isEnabled: (organizationId) =>
          dependencies.featureFlags.isEnabled("release_pulled_usage_cost_enabled", {
            kind: "organization",
            organizationId,
          }),
      },
      usageRecords: PulledUsageRecordService.create(
        PulledUsagePricingService.create({ rate: ratePulledUsage }),
      ),
      diagnostics,
      traceIngestion: {
        ingest: async ({ projectId, request }) => {
          const result = await dependencies.traces.otlpTraces({
            tenantId: projectId,
            traceRequest: request,
          });
          return {
            rejectedSpans: result.rejectedSpans ?? 0,
            ingestionFailures: result.ingestionFailures ?? 0,
            ...(result.ingestionFailureMessage
              ? { ingestionFailureMessage: result.ingestionFailureMessage }
              : {}),
          };
        },
      },
    });
    const pulledUsage: PulledUsageDispatcher = {
      recordPulledUsage: (input) => this.pulledUsageSender("recordPulledUsage").send(input),
    };
    return IngestionPullProcess.create({
      schedule: { nextRunAt: nextIngestionPullRunAt },
      execution: IngestionPullService.create({
        runPort: { run: (input) => worker.run({ ...input, pulledUsage }) },
        outcomePort: {
          completed: (input) => this.ingestionPullSender("recordRunCompleted").send(input),
          failed: (input) => this.ingestionPullSender("recordRunFailed").send(input),
        },
        metrics: IngestionPullMetricsService.create(),
      }),
      listing: IngestionPullListingService.create({
        sources: repositories.ingestionSources,
        agents: this.agentDiscovery,
        people: this.personListing,
        outcomes: {
          agentsListed: (input) => this.ingestionPullSender("recordAgentsListed").send(input),
          agentsListingRefused: (input) =>
            this.ingestionPullSender("recordAgentsListingRefused").send(input),
          peopleListed: (input) => this.ingestionPullSender("recordPeopleListed").send(input),
          peopleListingRefused: (input) =>
            this.ingestionPullSender("recordPeopleListingRefused").send(input),
        },
      }),
    });
  }

  cliAccess(): GovernanceCliAccessApi {
    return this.cliAccessService ?? this.unfinishedCapability();
  }

  /** Everything `/api/auth/cli` hands back or mints. */
  cliCredentials(): GovernanceCliCredentialApi {
    return this.cliCredentialService ?? this.unfinishedCapability();
  }

  /** The Activity Monitor reads, each with its ownership proof. */
  cliActivity(): GovernanceCliActivityApi {
    return this.cliActivityService ?? this.unfinishedCapability();
  }

  /** The same governance capability the console's tRPC procedures read. */
  governance(): GovernanceApi {
    return this.governanceApi;
  }

  cliBudgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).budgetStatus(input);
  }

  cliBootstrapRead(input: GovernanceCliRequest): Promise<GovernanceCliBootstrapAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).bootstrap(input);
  }

  cliBudgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).budgetOverview(input);
  }

  cliPersonalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).personalProject(input);
  }

  cliVirtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).virtualKey(input);
  }

  cliProjectKey(input: GovernanceCliRawRequest): Promise<GovernanceCliProjectKeyAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).projectKey(input);
  }

  cliIngestionSources(
    input: GovernanceCliSourcesRequest,
  ): Promise<GovernanceCliIngestionSourcesAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionSources(input);
  }

  cliIngestionSourceEvents(
    input: GovernanceCliSourceEventsRequest,
  ): Promise<GovernanceCliIngestionSourceEventsAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionSourceEvents(input);
  }

  cliIngestionSourceHealth(
    input: GovernanceCliSourceRequest,
  ): Promise<GovernanceCliIngestionSourceHealthAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionSourceHealth(input);
  }

  cliGovernanceStatus(input: GovernanceCliRequest): Promise<GovernanceCliGovernanceStatusAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).governanceStatus(input);
  }

  cliIngestionTemplates(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliIngestionTemplatesAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionTemplates(input);
  }

  cliIngestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionKey(input);
  }

  cliIngestionKeys(input: GovernanceCliRequest): Promise<GovernanceCliIngestionKeysAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionKeys(input);
  }

  cliIngestionKeyState(
    input: GovernanceCliKeyLookupRequest,
  ): Promise<GovernanceCliIngestionKeyStateAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionKeyState(input);
  }

  // ── The push-mode ingestion receivers ─────────────────────────────────────

  ingestOtlpTraces(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveOtlpTraces(input);
  }

  ingestWebhook(input: GovernanceIngestWebhookInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveWebhook(input);
  }

  ingestOtlpLogs(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveOtlpLogs(input);
  }

  ingestOtlpMetrics(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveOtlpMetrics(input);
  }

  // ── Ingestion templates ───────────────────────────────────────────────────

  /** The templates a member of this project's organization may pick from. */
  async listIngestionTemplatesForMember(scope: {
    projectId: string;
  }): Promise<IngestionTemplate[]> {
    const organizationId = await this.organizationOf(scope.projectId);
    return this.templates.listForUser({ organizationId });
  }

  /** The same union, with the canonical OTTL source on every row. */
  async listIngestionTemplatesForAdmin(scope: { projectId: string }): Promise<IngestionTemplate[]> {
    const organizationId = await this.organizationOf(scope.projectId);
    return this.templates.listForOrgAdmin({ organizationId });
  }

  /** One template, scoped to the project's organization. */
  async getIngestionTemplate(input: { projectId: string; id: string }): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(input.projectId);
    return this.templates.getByIdForOrg({
      id: input.id,
      organizationId,
    });
  }

  /**
   * Creates an org-authored template, attributed to the caller who asked.
   *
   * The attribution is here rather than in the door because "who authored this
   * template" is a property of the act, not of the transport it arrived over,
   * and a door stamping it for itself is a chance to stamp it differently or
   * not at all.
   */
  async createIngestionTemplate(
    input: {
      sourceType: string;
      displayName: string;
      description?: string | null;
      iconAsset?: string | null;
      credentialSchema?: string | null;
      ottlRules?: string;
    },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(by.projectId);
    return this.templates.createOrgTemplate({
      organizationId,
      callerUserId: attributedUserId(by),
      sourceType: input.sourceType,
      displayName: input.displayName,
      description: input.description ?? null,
      iconAsset: input.iconAsset ?? null,
      credentialSchema: input.credentialSchema ?? null,
      ottlRules: input.ottlRules,
      surface: by.surface,
    });
  }

  /** Replaces a template's OTTL, attributed to the caller who asked. */
  async updateIngestionTemplateOttlRules(
    input: { id: string; ottlRules: string },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(by.projectId);
    return this.templates.updateOttlRules({
      organizationId,
      callerUserId: attributedUserId(by),
      id: input.id,
      ottlRules: input.ottlRules,
      surface: by.surface,
    });
  }

  /** Soft-archives an org-authored template, attributed to the caller. */
  async archiveIngestionTemplate(
    input: { id: string },
    by: GovernanceProjectCaller,
  ): Promise<void> {
    const organizationId = await this.organizationOf(by.projectId);
    await this.templates.archiveOrgTemplate({
      organizationId,
      callerUserId: attributedUserId(by),
      id: input.id,
      surface: by.surface,
    });
  }

  /** Forks a platform template into the caller's organization. */
  async cloneIngestionTemplate(
    input: { sourceTemplateId: string },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(by.projectId);
    return this.templates.cloneFromPlatform({
      organizationId,
      callerUserId: attributedUserId(by),
      sourceTemplateId: input.sourceTemplateId,
      surface: by.surface,
    });
  }

  // ── Departments ────────────────────────────────────────────────────────────

  /** Finds a department by name, or creates it, for SCIM cost-center sync. */
  async departmentResolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department> {
    return this.departments.resolveByNameOrCreate(input);
  }

  /** Assigns (or clears) a member's department, for SCIM cost-center sync. */
  async departmentAssignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.departments.assignUser(input);
  }

  // ── Personal virtual keys ─────────────────────────────────────────────────

  /**
   * Personal keys in an organization. Never returns the secret.
   *
   * A personal key belongs to its principal, so the caller's own keys need no
   * permission. `targetUserId` names someone else's, and omitting it asks for
   * every member's; both widen the result past the caller and so are answered
   * only for a holder of `virtualKeys:viewOtherPersonal` at this organization.
   */
  async listPersonalVirtualKeys(
    input: { organizationId: string; targetUserId?: string },
    by: GovernanceCaller,
  ): Promise<PersonalVirtualKey[]> {
    await this.assertOrganizationMembership({
      organizationId: input.organizationId,
      userId: by.id,
    });

    const principalUserId = await this.resolvePersonalKeyPrincipal(input, by);
    const query: ListPersonalVirtualKeysInput = {
      organizationId: input.organizationId,
      ...(principalUserId === undefined ? {} : { userId: principalUserId }),
    };
    return this.governanceApi.personalVirtualKeyList(query);
  }

  /**
   * Issues a personal key under the given label, attributed to its principal.
   *
   * Returns the secret exactly once — the caller must persist it immediately.
   */
  async issuePersonalVirtualKey(
    input: { organizationId: string; label: string; routingPolicyId?: string },
    by: GovernanceCaller,
  ): Promise<IssuedPersonalVirtualKey> {
    await this.assertOrganizationMembership({
      organizationId: input.organizationId,
      userId: by.id,
    });

    // Lazy backfill for members who joined before personal workspaces shipped.
    const workspace = await this.dependencies.organizations.ensurePersonalWorkspace({
      userId: by.id,
      organizationId: input.organizationId,
      displayName: by.displayName ?? null,
      displayEmail: by.displayEmail ?? null,
    });

    const duplicate = await this.dependencies.personalVirtualKeys.hasActivePersonalKeyLabelled({
      organizationId: input.organizationId,
      userId: by.id,
      label: input.label,
    });
    if (duplicate) throw new PersonalVirtualKeyLabelTakenError(input.label);

    try {
      return await this.governanceApi.personalVirtualKeyIssue({
        userId: by.id,
        organizationId: input.organizationId,
        personalProjectId: workspace.project.id,
        personalTeamId: workspace.team.id,
        label: input.label,
        routingPolicyId: input.routingPolicyId,
      });
    } catch (error) {
      if (error instanceof NoEligibleProvidersError) {
        throw new NoEligibleModelProvidersError(error.organizationId);
      }
      if (error instanceof RoutingPolicyHasNoProvidersError) {
        throw new RoutingPolicyEmptyError(error.routingPolicyId, error.routingPolicyName);
      }
      throw error;
    }
  }

  /** Revokes one of the caller's own personal keys. Idempotent. */
  async revokePersonalVirtualKey(
    input: { organizationId: string; id: string },
    by: GovernanceCaller,
  ): Promise<void> {
    await this.assertOrganizationMembership({
      organizationId: input.organizationId,
      userId: by.id,
    });

    try {
      await this.governanceApi.personalVirtualKeyRevoke({
        userId: by.id,
        organizationId: input.organizationId,
        virtualKeyId: input.id,
      });
    } catch (error) {
      if (error instanceof PersonalVirtualKeyNotFoundError) {
        throw new PersonalVirtualKeyMissingError(error.virtualKeyId);
      }
      throw error;
    }
  }

  // ── The member's own dashboard ────────────────────────────────────────────

  /**
   * Whether the caller belongs to this organization at all.
   *
   * Answered rather than enforced because the /me door re-checks membership
   * after `organization:view` and sends its own refusal: the permission says
   * the caller may act on an organization, this says the one they named is
   * theirs, which is what keeps a personal rollup inside their own tenant.
   */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.dependencies.personalVirtualKeys.isOrganizationMember(input);
  }

  /**
   * One person's own usage against a tenant the caller has already resolved:
   * the totals, the per-day buckets, and the split by model.
   */
  personalUsage(input: PersonalUsageQueryInput): Promise<PersonalUsageRollup> {
    return (this.personalUsageDashboards ?? this.unfinishedCapability()).rollup(input);
  }

  /**
   * The same rollup for the caller's own /me screen, over the tenants their
   * traffic actually lands in. Zeros before their first request, so the page
   * renders rather than refusing.
   */
  personalUsageDashboard(
    input: { organizationId: string; window?: PersonalUsageWindow },
    by: GovernanceCaller,
  ): Promise<PersonalUsageRollup> {
    return (this.personalUsageDashboards ?? this.unfinishedCapability()).read({
      userId: by.id,
      organizationId: input.organizationId,
      window: input.window,
    });
  }

  /**
   * Every budget that binds the caller's own keys in this organization, each
   * labelled with its scope, most binding first.
   *
   * The caller is always the subject: a member reads their OWN overview, which
   * is why the user id comes from `by` rather than from the input. One source,
   * so the /me screen and the CLI's login epilogue can never report different
   * numbers for the same budget.
   */
  personalBudgetOverview(
    input: { organizationId: string; includeTopModels?: boolean },
    by: GovernanceCaller,
  ): Promise<GovernanceBudgetOverviewForUser> {
    return this.governanceApi.personalBudgetOverviewForUser({
      organizationId: input.organizationId,
      userId: by.id,
      includeTopModels: input.includeTopModels,
    });
  }

  /**
   * What the CLI's login-completion ceremony renders: the tools and providers
   * this organization publishes to the caller, and their monthly budget.
   */
  cliBootstrap(
    input: { organizationId: string },
    by: GovernanceCaller,
  ): Promise<CliBootstrapResult> {
    return this.governanceApi.cliBootstrapResolve({
      userId: by.id,
      organizationId: input.organizationId,
    });
  }

  /**
   * The personal workspace behind a CH-side `actor` token, for the bird's-eye
   * "View their workspace →" link on `/governance/users/[id]`.
   *
   * Three refusals collapse to one `null`: the token names nobody, the person
   * it names is not in this organization, or they have no personal workspace
   * yet. Keeping them indistinguishable is deliberate — a caller who may read
   * the governance surface still learns nothing about who else exists on the
   * instance from the shape of the answer.
   */
  async findActorWorkspace(input: {
    organizationId: string;
    actor: string;
  }): Promise<GovernanceActorWorkspace | null> {
    const user = await this.dependencies.actors.findUser({ token: input.actor });
    if (!user) return null;

    const member = await this.isOrganizationMember({
      organizationId: input.organizationId,
      userId: user.id,
    });
    if (!member) return null;

    const workspace = await this.dependencies.organizations
      .getPersonalWorkspace({
        userId: user.id,
        organizationId: input.organizationId,
      })
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) return null;

    return {
      userId: user.id,
      // The admin reading the link needs a person, and any of the three
      // columns identifies one; the id is the last resort rather than a blank.
      displayName: user.name ?? user.email ?? user.id,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
      projectSlug: workspace.project.slug,
    };
  }

  // ── Routing policies ──────────────────────────────────────────────────────

  /** Policies in an organization, optionally narrowed to one scope's choices. */
  listRoutingPolicies(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    return this.governanceApi.routingPolicyList(input);
  }

  /** One policy by id, including its scope rows. */
  getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy> {
    return this.governanceApi.routingPolicyGetById(input);
  }

  /** Creates a policy, attributed to the caller who asked for it. */
  async createRoutingPolicy(
    input: Omit<CreateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    try {
      return await this.governanceApi.routingPolicyCreate({
        ...input,
        actorUserId: by.id,
      });
    } catch (error) {
      throw asHandledRoutingPolicyError(error);
    }
  }

  /** Updates a policy, attributed to the caller who asked for it. */
  async updateRoutingPolicy(
    input: Omit<UpdateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    try {
      return await this.governanceApi.routingPolicyUpdate({
        ...input,
        actorUserId: by.id,
      });
    } catch (error) {
      throw asHandledRoutingPolicyError(error);
    }
  }

  /** Makes one policy the organization's default. */
  setDefaultRoutingPolicy(
    input: Omit<SetDefaultRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    return this.governanceApi.routingPolicySetDefault({
      ...input,
      actorUserId: by.id,
    });
  }

  /** Removes one policy from the organization. */
  deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void> {
    return this.governanceApi.routingPolicyDelete(input);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private organizationOf(projectId: string): Promise<string> {
    return this.dependencies.projects.getOrganizationId(projectId);
  }

  /** Refuses a caller who is not in the organization they named. */
  private async assertOrganizationMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    if (await this.dependencies.personalVirtualKeys.isOrganizationMember(input)) return;
    throw new PermissionDeniedError({
      permission: "organization:view",
      scope: { type: "organization", id: input.organizationId },
      denialReason: "no-membership",
    });
  }

  /**
   * Which principal's keys the caller may see: their own always, anyone
   * else's — or the whole organization, when no target is named — only with
   * `virtualKeys:viewOtherPersonal`. `undefined` means every member's.
   */
  private async resolvePersonalKeyPrincipal(
    input: { organizationId: string; targetUserId?: string },
    by: GovernanceCaller,
  ): Promise<string | undefined> {
    if (input.targetUserId === by.id) return by.id;

    const { permitted: canViewOthers } = await this.dependencies.permissions.getDecision({
      userId: by.id,
      permission: "virtualKeys:viewOtherPersonal",
      scope: { tier: "organization", id: input.organizationId },
    });
    if (input.targetUserId !== undefined) {
      if (!canViewOthers) {
        throw new PermissionDeniedError({
          permission: "virtualKeys:viewOtherPersonal",
          scope: { type: "organization", id: input.organizationId },
          denialReason: "no-binding",
        });
      }
      return input.targetUserId;
    }
    return canViewOthers ? undefined : by.id;
  }
}

/**
 * Who a project-scoped write is recorded against.
 *
 * A legacy project API key is bound to a project rather than to a person, so
 * there is no user to name; `svc_<projectId>` is what the audit row carries
 * instead, and it has to be one string, decided once.
 */
function attributedUserId(by: GovernanceProjectCaller): string {
  return by.userId ?? `svc_${by.projectId}`;
}

function cliAccessTokens(auth: Pick<AuthApi, "findCliAccessSession" | "revokeCliAccessToken">) {
  return {
    async resolve(authorization: string | null | undefined) {
      const session = await auth.findCliAccessSession({ authorization });
      return session ? toGovernanceCliCaller(session) : null;
    },
    revoke: ({ authHeader, userId }: { authHeader: string | null | undefined; userId: string }) =>
      auth.revokeCliAccessToken({ authorization: authHeader, userId }),
  };
}

function toGovernanceCliCaller(session: CliAccessSession) {
  return {
    user_id: session.userId,
    organization_id: session.organizationId,
    ...(session.clientInfo
      ? {
          client_info: {
            device_label: session.clientInfo.deviceLabel,
            hostname: session.clientInfo.hostname,
          },
        }
      : {}),
  };
}

/**
 * The Governance contract's three routing-policy guards, as handled errors
 * with stable codes. Anything else is returned untouched so it degrades to a
 * generic unknown carrying a trace id, per ADR-045.
 */
function asHandledRoutingPolicyError(error: unknown): unknown {
  if (error instanceof RoutingPolicyMustHaveProviderError) {
    return new RoutingPolicyProviderRequiredError();
  }
  if (error instanceof RoutingPolicyMustHaveScopeError) {
    return new RoutingPolicyScopeRequiredError();
  }
  if (error instanceof RoutingPolicyModelMustBeConcreteError) {
    return new RoutingPolicyModelNotConcreteError(error.field, error.value);
  }
  return error;
}

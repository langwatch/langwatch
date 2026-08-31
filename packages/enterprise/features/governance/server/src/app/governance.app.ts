// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The governance feature's application: what all three of its doors call.
 *
 * Governance answers over two transports today — a project-scoped REST family
 * (ingestion templates) and two tRPC surfaces (personal virtual keys, routing
 * policies) — and before this each door declared its own private bag. The two
 * tRPC files each wrote `Readonly<{ governance: GovernanceService }>`, agreeing
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
import type { AuthzService } from "@langwatch/authz-contract";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyNotFoundError,
  RoutingPolicyHasNoProvidersError,
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  type CliBootstrapResult,
  type CreateRoutingPolicyInput,
  type DeleteRoutingPolicyInput,
  type FindRoutingPolicyInput,
  type GovernanceBudgetOverviewForUser,
  type GovernanceCallSurface,
  type GovernanceService,
  type IngestionTemplate,
  type IssuedPersonalVirtualKey,
  type ListPersonalVirtualKeysInput,
  type ListRoutingPoliciesInput,
  type PersonalVirtualKey,
  type PersonalUsageQueryInput,
  type PersonalUsageWindow,
  type RoutingPolicy,
  type SetDefaultRoutingPolicyInput,
  type UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-governance-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  PersonalUsageDashboardService,
  type PersonalUsageRollup,
} from "../services/personal-usage-dashboard.service";

/**
 * A member already holds an unrevoked personal key under this label.
 *
 * The (organizationId, principalUserId, name) tuple is the personal-key
 * uniqueness contract: two members of one organization may each hold a
 * "default", but one member may not hold two. 409 because the request is well
 * formed and the caller can act on it by choosing another label.
 */
export class PersonalVirtualKeyLabelTakenError extends HandledError {
  declare readonly code: "personal_virtual_key_label_taken";

  constructor(label: string) {
    super(
      "personal_virtual_key_label_taken",
      "A personal key with this label already exists",
      { httpStatus: 409, meta: { label } },
    );
    this.name = "PersonalVirtualKeyLabelTakenError";
  }
}

/**
 * Default resolution found nothing to route through: the organization has no
 * accessible provider credential at all.
 *
 * 409 so the CLI and the /me screen surface the actionable "ask your admin to
 * add a provider" message at mint time, instead of letting the member discover
 * the gap through a copy-pasted request that never answers.
 */
export class NoEligibleModelProvidersError extends HandledError {
  declare readonly code: "no_eligible_model_providers";

  constructor(organizationId: string) {
    super(
      "no_eligible_model_providers",
      "The organization has no usable model provider",
      { httpStatus: 409, meta: { organizationId } },
    );
    this.name = "NoEligibleModelProvidersError";
  }
}

/**
 * The caller pinned a routing policy that has no providers on it. 422: the
 * request is well formed, but the policy it names cannot yet serve one.
 */
export class RoutingPolicyEmptyError extends HandledError {
  declare readonly code: "routing_policy_has_no_providers";

  constructor(routingPolicyId: string, routingPolicyName: string) {
    super(
      "routing_policy_has_no_providers",
      "That routing policy has no providers on it",
      { httpStatus: 422, meta: { routingPolicyId, routingPolicyName } },
    );
    this.name = "RoutingPolicyEmptyError";
  }
}

/** A personal key the caller named does not exist, or is not theirs. */
export class PersonalVirtualKeyMissingError extends HandledError {
  declare readonly code: "virtual_key_not_found";

  constructor(virtualKeyId: string) {
    super("virtual_key_not_found", "Personal virtual key not found", {
      httpStatus: 404,
      meta: { virtualKeyId },
    });
    this.name = "PersonalVirtualKeyMissingError";
  }
}

/** A routing policy was written with no provider credential on it. */
export class RoutingPolicyProviderRequiredError extends HandledError {
  declare readonly code: "routing_policy_must_have_provider";

  constructor() {
    super(
      "routing_policy_must_have_provider",
      "A routing policy needs at least one provider",
      { httpStatus: 422 },
    );
    this.name = "RoutingPolicyProviderRequiredError";
  }
}

/** A routing policy was written with no scope to apply at. */
export class RoutingPolicyScopeRequiredError extends HandledError {
  declare readonly code: "routing_policy_must_have_scope";

  constructor() {
    super(
      "routing_policy_must_have_scope",
      "A routing policy needs at least one scope",
      { httpStatus: 422 },
    );
    this.name = "RoutingPolicyScopeRequiredError";
  }
}

/**
 * A moving model name ("newest", "latest") was written onto a policy. Stored,
 * it would make the gateway dispatch a model literally called that.
 */
export class RoutingPolicyModelNotConcreteError extends HandledError {
  declare readonly code: "routing_policy_model_must_be_concrete";

  constructor(field: string, value: string) {
    super(
      "routing_policy_model_must_be_concrete",
      "That model name does not point at one specific model",
      { httpStatus: 422, meta: { field, value } },
    );
    this.name = "RoutingPolicyModelNotConcreteError";
  }
}

/**
 * The two questions personal virtual keys ask of the process's database.
 *
 * They are ports rather than service calls because both are single-row
 * existence checks the Governance service does not own: one reads organization
 * membership, the other the virtual-key uniqueness tuple.
 */
export interface GovernancePersonalVirtualKeyPorts {
  /** Whether the caller belongs to this organization at all. */
  isOrganizationMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
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
  tryFindUser(input: { token: string }): Promise<GovernanceActorUser | null>;
}

/** The identity columns an actor drill-in reads. */
export interface GovernanceActorUser {
  id: string;
  name: string | null;
  email: string | null;
}

/** Where an actor's own workspace lives, for the admin's drill-in link. */
export interface GovernanceActorWorkspace {
  userId: string;
  displayName: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
}

/** What the process composes this feature's application from. */
export interface GovernanceAppDependencies {
  governance: GovernanceService;
  /**
   * The organization a project belongs to, for the project-scoped REST family,
   * and the organization's hidden governance project, which is the tenant an
   * ingestion source's usage rows land in.
   */
  projects: Pick<ProjectService, "getOrganizationId" | "tryFindInternal">;
  /**
   * The member's personal workspace: created on demand when they mint their
   * first key, read as it stands when they open their own dashboard.
   */
  organizations: Pick<OrganizationService, "ensurePersonalWorkspace" | "tryFindPersonalWorkspace">;
  /**
   * The process's permission engine. Read directly rather than through a port
   * because the one question this feature asks it — may the caller see somebody
   * else's personal keys — is a plain decision at the organization scope.
   */
  permissions: Pick<AuthzService, "getDecision">;
  personalVirtualKeys: GovernancePersonalVirtualKeyPorts;
  /** Resolves the actor token stamped on a span to the person who owns it. */
  actors: GovernanceActorDirectory;
}

/** Who a call is attributed to, and (for a lazy backfill) what to name them. */
export interface GovernanceCaller {
  readonly id: string;
  readonly displayName?: string | null;
  readonly displayEmail?: string | null;
}

/**
 * Who a project-scoped REST call is attributed to.
 *
 * `userId` is absent for a legacy project API key, which is bound to a project
 * rather than to a person.
 */
export interface GovernanceProjectCaller {
  readonly projectId: string;
  readonly userId?: string | null;
  /** Which surface initiated the change, for the audit row. */
  readonly surface: GovernanceCallSurface;
}

export class GovernanceApp {
  static create(dependencies: GovernanceAppDependencies): GovernanceApp {
    return new GovernanceApp(dependencies);
  }

  private constructor(private readonly dependencies: GovernanceAppDependencies) {
    this.personalUsageDashboards = PersonalUsageDashboardService.create({
      governance: dependencies.governance,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
    });
  }

  private readonly personalUsageDashboards: PersonalUsageDashboardService;

  // ── Ingestion templates ───────────────────────────────────────────────────

  /** The templates a member of this project's organization may pick from. */
  async listIngestionTemplatesForMember(scope: {
    projectId: string;
  }): Promise<IngestionTemplate[]> {
    const organizationId = await this.organizationOf(scope.projectId);
    return this.dependencies.governance.templateListForUser({ organizationId });
  }

  /** The same union, with the canonical OTTL source on every row. */
  async listIngestionTemplatesForAdmin(scope: {
    projectId: string;
  }): Promise<IngestionTemplate[]> {
    const organizationId = await this.organizationOf(scope.projectId);
    return this.dependencies.governance.templateListForOrgAdmin({ organizationId });
  }

  /** One template, scoped to the project's organization. */
  async getIngestionTemplate(input: {
    projectId: string;
    id: string;
  }): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(input.projectId);
    return this.dependencies.governance.templateGetByIdForOrg({
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
    return this.dependencies.governance.templateCreateOrg({
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
    return this.dependencies.governance.templateUpdateOttlRules({
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
    await this.dependencies.governance.templateArchiveOrg({
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
    return this.dependencies.governance.templateCloneFromPlatform({
      organizationId,
      callerUserId: attributedUserId(by),
      sourceTemplateId: input.sourceTemplateId,
      surface: by.surface,
    });
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
    return this.dependencies.governance.personalVirtualKeyList(query);
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
      return await this.dependencies.governance.personalVirtualKeyIssue({
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
      await this.dependencies.governance.personalVirtualKeyRevoke({
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
    return this.personalUsageDashboards.rollup(input);
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
    return this.personalUsageDashboards.read({
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
    return this.dependencies.governance.personalBudgetOverviewForUser({
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
    return this.dependencies.governance.cliBootstrapResolve({
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
  async tryResolveActorWorkspace(input: {
    organizationId: string;
    actor: string;
  }): Promise<GovernanceActorWorkspace | null> {
    const user = await this.dependencies.actors.tryFindUser({ token: input.actor });
    if (!user) return null;

    const member = await this.isOrganizationMember({
      organizationId: input.organizationId,
      userId: user.id,
    });
    if (!member) return null;

    const workspace = await this.dependencies.organizations.tryFindPersonalWorkspace({
      userId: user.id,
      organizationId: input.organizationId,
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
    return this.dependencies.governance.routingPolicyList(input);
  }

  /** One policy by id, including its scope rows. */
  getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy> {
    return this.dependencies.governance.routingPolicyGetById(input);
  }

  /** Creates a policy, attributed to the caller who asked for it. */
  async createRoutingPolicy(
    input: Omit<CreateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    try {
      return await this.dependencies.governance.routingPolicyCreate({
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
      return await this.dependencies.governance.routingPolicyUpdate({
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
    return this.dependencies.governance.routingPolicySetDefault({
      ...input,
      actorUserId: by.id,
    });
  }

  /** Removes one policy from the organization. */
  deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void> {
    return this.dependencies.governance.routingPolicyDelete(input);
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

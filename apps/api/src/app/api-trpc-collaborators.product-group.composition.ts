/**
 * The PRODUCT GROUP half of {@link ApiTrpcCollaborators}: the surfaces a member
 * reaches to run the product rather than to look at what it recorded.
 *
 *   authz.*                      what the caller may do at one scope
 *   batchRecord.*                the batch-evaluation rollups over a project
 *   dataset.* / datasetRecord.*  a project's datasets and the rows inside them
 *   evaluators.*                 the evaluators a project defines and copies
 *   featureFlag.*                which rollouts this tenant is inside
 *   home.*                       the recent-activity strip the home page renders
 *   personalWorkspaceFeatures.*  what a personal workspace may switch on
 *   prompts.* / promptTags.*     a project's prompt library and its tag catalogue
 *   role.* / roleBinding.*       custom role definitions and who holds them
 *   team.*                       a team, its members and their roles
 *
 * They are one composition because they are one graph in the only way that
 * matters at a composition root: every one of them is answered from this
 * process's OWN Prisma connection, its OWN AuthZ service and the tenancy graph
 * it already composed. None of them reaches ClickHouse, the model gateway, the
 * NLP engine or a mailer, which is what separates this half from the execution
 * and identity halves rather than any product taxonomy.
 *
 * ## This half OVERLAYS
 *
 * Unlike {@link composeApiProductCollaborators}, which seeds the collaborator
 * set, this one folds onto a base and passes an absent base through untouched.
 * The reason is the same one the analytics and execution halves have: it can
 * genuinely be missing. A process that composed no tenancy graph has no
 * organization or project directory to resolve a flag's tenant target through,
 * and a flag surface answering "not enabled" because it could not resolve the
 * organization would be a rollout silently switched off for everybody.
 *
 * ## The two named absences
 *
 * `team.assertCustomRolesAllowed` is the Enterprise plan gate on assigning a
 * custom role to a member. This process composes no billing store, so it
 * REFUSES by name rather than permitting: permitting would hand an Enterprise
 * capability to a deployment whose plan does not carry it, and the refusal is
 * the same `service_unavailable` shape every other absent Enterprise capability
 * in this graph answers with.
 *
 * `prompts.afterPromptCreated` is a lifecycle nurturing signal — a marketing
 * side effect on somebody's first prompt. It is fire-and-forget by
 * construction, so an absent product-analytics sink logs once instead of
 * refusing: refusing would cost a customer the prompt they just wrote, to
 * protect an email nobody was waiting on.
 */
import {
  bindingScopeCanGrantPermission,
  authzPermissionSchema,
  type AuthzGrantsService,
  type AuthzService,
} from "@langwatch/authz-contract";
import { AuthzApp, KsuidAuthzBindingIdAdapter } from "@langwatch/authz-server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import { assertNoPersonalTeamScope, type TeamTrpcPorts } from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import {
  PostgresRecentItemsAdapter,
  type HomeTrpcPorts,
  type RecentItem,
} from "@langwatch/project-server";
import type { RoleBindingScopeType, RoleService } from "@langwatch/role-contract";
import {
  PostgresRoleAdapter,
  RoleApp,
  RolePermissionPort,
  RoleScopePort,
} from "@langwatch/role-server";
import type { RoleTrpcPorts } from "../features/role/role-trpc.mount";
import type { ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";

/**
 * A capability this deployment did not compose, refused by name.
 *
 * One class for every entry in this half rather than one per entry: the
 * customer-facing distinction is WHICH capability is missing, and that is the
 * `capability` the message carries. A subclass per absence would be six classes
 * for one code, and the code is what the presentation registry is keyed by.
 */
class ApiProductGroupUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiProductGroupUnavailableError";
  }
}

/**
 * The Enterprise plan gate on assigning a custom role, for a deployment that
 * composes one.
 *
 * A port rather than a `PlanProvider`, because what the team surface asks is
 * one question — may this organization's plan carry custom roles — and the
 * provider behind it takes a billing store, a Stripe client and a licence
 * reader that none of the other five surfaces here need.
 */
export abstract class ApiCustomRolePlanGatePort {
  /** Throws when the organization's plan may not assign a custom role. */
  abstract assertCustomRolesAllowed(input: {
    organizationId: string;
    members: readonly Readonly<{ role: string }>[];
  }): Promise<void>;
}


export type ApiProductGroupCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /**
   * The organization directory the tenancy graph composed.
   *
   * Held rather than used to build an application: `team.*` reads
   * `ctx.app.organizations`, which the identity half owns. This is here so the
   * gate below is a decision about the graph rather than about one port — a
   * process with no organization directory can resolve no team at all.
   */
  organizations: OrganizationService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /**
   * The process's ONE rollout store, composed by the feature-flag feature.
   *
   * Taken rather than built: this half used to build one and the analytics half
   * another, so a rollout had two objects answering it in one process.
   */
  featureFlags: FeatureFlagService;
  /**
   * The grant ledger custom-role bindings are written through.
   *
   * The SAME ledger the AuthZ service reads decisions from: a binding written
   * to one and read from another is a role that appears to have been granted
   * and grants nothing.
   */
  grants: AuthzGrantsService;
  /** The Enterprise plan gate, where the deployment composed one. */
  customRolePlan?: ApiCustomRolePlanGatePort;
}>;

/** The application slices and the port groups this half owns, composed together. */
export type ApiProductGroupCollaborators = Readonly<{
  /** For `ctx.app.authzApp`. */
  authzApp: AuthzApp;
  /** For `ctx.app.featureFlags`. */
  featureFlagService: FeatureFlagService;
  /** For `ctx.app.permissions`. */
  permissions: Pick<AuthzService, "hasPermission">;
  /** For `ctx.app.projects`. */
  projectReads: Readonly<{ getOrganizationId(projectId: string): Promise<string> }>;
  /** For `ctx.app.roles` — the same application both role surfaces read. */
  roleApp: RoleApp;
  /**
   * The role service under {@link ApiProductGroupCollaborators.roleApp}.
   *
   * Exposed beside the application rather than composed a second time, because
   * one other surface asks it a question no application method carries: the
   * invitation half asks which custom roles an organization MAY ASSIGN, and an
   * invitation validated against a second copy of that rule would be accepted
   * on write and silently dropped on acceptance.
   */
  roles: RoleService;
  /** The `home` entry. */
  homePorts: HomeTrpcPorts;
  /** The `role` entry. */
  rolePorts: RoleTrpcPorts;
  /** The `team` entry. */
  teamPorts: TeamTrpcPorts;
}>;


/** Composes the product-group half from this process's own graph. */
export function composeApiProductGroupCollaborators(
  options: ApiProductGroupCollaboratorsOptions,
): ApiProductGroupCollaborators {
  const logger = createLogger("langwatch:api:product-group");

  const authzApp = AuthzApp.create({ permissions: options.authz });

  const featureFlagService = options.featureFlags;

  const recentItems = PostgresRecentItemsAdapter.create({ database: options.prisma }).build();

  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  const roles = PostgresRoleAdapter.create({
    database: options.prisma,
    grants: options.grants,
    permissions: options.authz,
    newBindingId: () => bindingIds.newBindingId(),
    scope: new ApiRoleScope(options.prisma),
    permission: new ApiRolePermissions(),
  }).build();
  const roleApp = RoleApp.create({
    roles,
    permissions: options.authz,
    authzGrants: options.grants,
  });

  return {
    authzApp,
    featureFlagService,
    permissions: options.authz,
    projectReads: options.projects,
    roleApp,
    roles,
    homePorts: {
      /**
       * The strip walks this process's own audit trail and then hydrates each
       * entity it finds there, so it is answered from the connection rather
       * than from any one feature's service — five verticals' rows behind one
       * read is nobody's service but the application's.
       */
      getRecentItems: (
        _ctx,
        input: Readonly<{ userId: string; projectId: string; limit: number }>,
      ): Promise<RecentItem[]> => recentItems.getRecentItems(input),
    },
    rolePorts: {
      probeOrganizationPermission: (ctx, organizationId, permission) =>
        options.authz.hasPermission({
          userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
          permission,
          organizationId,
        }),
      assertCustomRolePlan: async (_ctx, input) => {
        const gate = options.customRolePlan;
        if (!gate) {
          logger.warn(
            { organizationId: input.organizationId },
            "no Enterprise plan gate is composed: refusing a custom role definition or assignment",
          );
          throw new ApiProductGroupUnavailableError("Custom roles");
        }
        await gate.assertCustomRolesAllowed({ organizationId: input.organizationId, members: [] });
      },
      /**
       * The permission vocabulary a custom role's entries are parsed against.
       *
       * The AuthZ REGISTRY's enumeration rather than the cross product of every
       * resource and every action: the registry is what the engine actually
       * evaluates, so a role naming a pair outside it would store a grant that
       * can never match.
       */
      customRolePermission: authzPermissionSchema,
    },
    teamPorts: composeTeamPorts(options, logger),
  };
}

/**
 * The two answers the team surface needs from the deployment.
 *
 * `probeOrganizationPermission` is not a gate — the two member reads pass it to
 * the service, which widens or narrows what each row shows — so it is answered
 * by the same AuthZ service the declared check on the procedure already ran on.
 * A second permission service here would be a second answer to one question.
 */
function composeTeamPorts(
  options: ApiProductGroupCollaboratorsOptions,
  logger: Pick<Logger, "warn">,
): TeamTrpcPorts {
  return {
    probeOrganizationPermission: (ctx, organizationId, permission) =>
      options.authz.hasPermission({
        userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
        permission,
        organizationId,
      }),
    assertCustomRolesAllowed: async (_ctx, input) => {
      const gate = options.customRolePlan;
      if (!gate) {
        // Only a list that actually assigns a custom role is refused. A member
        // list carrying none never touches the Enterprise capability, and
        // refusing it would break team editing on every deployment that
        // composes no billing store.
        if (!input.members.some((member) => isCustomRole(member.role))) return;
        logger.warn(
          { organizationId: input.organizationId },
          "no Enterprise plan gate is composed: refusing a member list that assigns a custom role",
        );
        throw new ApiProductGroupUnavailableError("Custom role assignment");
      }
      await gate.assertCustomRolesAllowed({
        organizationId: input.organizationId,
        members: input.members,
      });
    },
  };
}

/**
 * Whether a member's role names a CUSTOM role rather than one of the built-in
 * team roles.
 *
 * A naming convention rather than an entitlement, which is why it travels with
 * the composition instead of with the plan gate: the built-in roles are a
 * closed set, so anything outside it is a role the organization defined.
 */
const BUILT_IN_TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER"]);

function isCustomRole(role: string): boolean {
  return !BUILT_IN_TEAM_ROLES.has(role);
}

/**
 * The personal-workspace fence a role binding is refused at, over this
 * process's own connection.
 *
 * The rule itself is the organization package's — a personal workspace has
 * exactly one admin, its owner, so a binding that reaches it is a grant into
 * somebody's private space — and this only supplies the client it reads teams
 * through.
 */
class ApiRoleScope extends RoleScopePort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async assertNoPersonalTeamScope(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<void> {
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: input.scopes });
  }
}

/**
 * ADR-021's scope fence, read off the AuthZ registry rather than a hand-kept
 * set.
 *
 * The registry records which tiers each resource is grantable at, so it cannot
 * fall behind a resource somebody added; the set it replaces could and did.
 * A permission the registry does not know is treated as non-exclusive, which is
 * what the legacy fence did with anything outside its own list.
 */
class ApiRolePermissions extends RolePermissionPort {
  isOrganizationExclusive(permission: string): boolean {
    return !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission });
  }

  organizationExclusiveScopeError(input: {
    permission: string;
    scopeType: RoleBindingScopeType;
  }): Error {
    return new OrgExclusivePermissionScopeError(input.permission, input.scopeType);
  }
}

/**
 * An organization-exclusive permission was bound at TEAM or PROJECT scope.
 *
 * Refused at write time rather than accepted and ignored: the resolver never
 * grants these below organization scope, so storing the binding would leave an
 * administrator believing a grant took effect that does nothing.
 */
class OrgExclusivePermissionScopeError extends HandledError {
  declare readonly code: "org_exclusive_permission_scope";

  constructor(permission: string, scopeType: string) {
    super(
      "org_exclusive_permission_scope",
      "That permission only takes effect at organization scope",
      { httpStatus: 422, meta: { permission, scopeType } },
    );
    this.name = "OrgExclusivePermissionScopeError";
  }
}


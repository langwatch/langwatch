/**
 * An organization, its membership and its invitations over the process's tRPC
 * transport. `organization`, `membership` and `invite` are all organization
 * subjects (`packages/features/catalogue.json`), which is why one surface owns
 * all three.
 *
 *   createAndAssign:   sign-up — the first organization and its first team.
 *   getAll:            every organization the caller can reach, with its teams
 *                      and projects, redacted to what the caller may hold.
 *   update:            the organization settings form.
 *   deleteMember /
 *   setMemberDisabled: removing a seat, and freeing one reversibly.
 *   getOrganizationWithMembersAndTheirTeams / getMemberById /
 *   getAllOrganizationMembers:  the member reads behind the admin screens and
 *                      the member pickers.
 *   updateMemberRole /
 *   updateTeamMemberRole: the two role changes.
 *   createInvites / deleteInvite / resendInvite /
 *   getOrganizationPendingInvites / acceptInvite: the invitation lifecycle.
 *   getAuditLogs:      the organization's audit trail.
 *
 * Reading the organization takes `organization:view`, which every member
 * holds. Everything that changes membership, settings or invitations takes
 * `organization:manage`. Three procedures declare no permission at all, and
 * the reason is the same for all three: they run BEFORE or ACROSS membership —
 * creating an organization, listing the caller's own, and accepting an
 * invitation are all things a non-member does.
 *
 * Transport only: gates, input parsing, error translation and delegation. The
 * feature's own application is the caller's own (`ctx.app.organizations`, an
 * `OrganizationApp`, which is also what `team.*`, `group.*` and the
 * personal-workspace predicate call);
 * everything else this surface touches — the invitation service, the licence
 * seat guards, the Enterprise plan gate, the identity ledger behind
 * invitation matching, secret decryption and the product-analytics trail — is
 * the process's, and arrives as a port.
 *
 * Spec: packages/features/organization/specs/organization-service.feature.
 */
import type {
  AuthzBindingForSynthesis,
  AuthzDeclaration,
  AuthzPermission,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { type Organization, type OrganizationInvite } from "@langwatch/prisma-client/generated";
import {
  organizationApiAcceptInviteInputSchema,
  organizationApiAuditLogsInputSchema,
  organizationApiCreateInvitesInputSchema,
  organizationApiGetAllInputSchema,
  organizationApiInviteScopeSchema,
  organizationApiMemberScopeSchema,
  organizationApiScopeSchema,
  organizationApiSetMemberDisabledInputSchema,
  organizationApiUpdateInputSchema,
  organizationApiUpdateMemberRoleInputSchema,
  organizationApiUpdateTeamMemberRoleInputSchema,
  organizationApiWithMembersInputSchema,
  organizationIntentSchema,
  type OrganizationApiMemberRole,
} from "@langwatch/organization-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { OrganizationApp } from "#app/organization.app";

/**
 * The display status the invitation list renders per row. `WAITING_APPROVAL`
 * is a deprecated Postgres enum value (D11 retirement) that no row carries any
 * more, but the column type still names it.
 */
type InviteDisplayStatus =
  | "PENDING"
  | "ACCEPTED"
  | "EXPIRED"
  | "REVOKED"
  | "WAITING_APPROVAL"
  | "PAYMENT_PENDING";

type ListedInvite = OrganizationInvite & {
  inviteUrl: string;
  displayStatus: InviteDisplayStatus;
  requestedByUser: { id: string; name: string | null; email: string | null } | null;
};

/** An invitation as `acceptInvite` reads it: the row plus its organization. */
type InviteWithOrganization = OrganizationInvite & { organization: Organization };

/**
 * The authenticated principal, as the process's session carries it. The whole
 * user travels rather than the id alone because three collaborators — the
 * plan provider, the seat guard and the disable guard — identify the operator
 * by more than their id.
 */
type OrganizationTrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type OrganizationTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApp }>;
  session: Readonly<{ user: OrganizationTrpcSessionUser }> | null;
}>;

type OrganizationTrpcProcedures<
  TContext extends OrganizationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
  /**
   * The same chain, around the audit-log read's OWN check.
   *
   * That read authorizes at the ORGANIZATION tier, always. A bare
   * `organization:view`-style declaration cannot express it: `auditLog:view`
   * is grantable at project/team/organization and the declared check resolves
   * to the narrowest tier whose id the input carries, so the optional
   * `projectId` filter would move the whole check to the project tier and
   * leave `organizationId` — the id the query is anchored on — unauthorized.
   * A caller holding `auditLog:view` on any one project could then read a
   * different organization's org-scoped trail. The rule therefore lives in a
   * `kind: "custom"` middleware the process writes and hands over already
   * wrapped, which is what `declaredCheckFrom` refuses to build from a
   * description.
   */
  auditLogPolicy<TProcedure>(procedure: TProcedure): TProcedure;
}>;

// ---------------------------------------------------------------------------
// The process capabilities this transport needs that are not the
// organization's own
// ---------------------------------------------------------------------------

/**
 * What a seat-limit refusal carries to the client's limit modal.
 *
 * The three values travel opaquely because that is how the refusal already
 * carried them: they are read off the handled error's `meta`, which is an
 * open record, and this transport forwards them into the tRPC `cause` without
 * inspecting any of them.
 */
type SeatLimitMeta = Readonly<{
  limitType: unknown;
  current: unknown;
  max: unknown;
}>;

/** The same facts where the refusal declares them as typed fields. */
type ResourceLimitFacts = Readonly<{
  limitType: string;
  current: number;
  max: number;
  message: string;
}>;

export type OrganizationTrpcPorts<TSignUpDataSchema extends z.ZodTypeAny = z.ZodTypeAny> =
  Readonly<{
    // -- input shapes the process owns ---------------------------------------
    /**
     * The sign-up questionnaire's schema. The process owns it because the
     * acquisition-attribution fields it carries are captured in the browser,
     * and `onboarding.initializeOrganization` parses the same shape.
     */
    signUpDataSchema: TSignUpDataSchema;

    // -- authorization -------------------------------------------------------
    /**
     * Whether the caller may administer the organization. Not a gate: three
     * reads use it to decide how much of the answer to redact, and a caller
     * who cannot manage still gets an answer.
     */
    probeOrganizationPermission(
      ctx: OrganizationTrpcContext,
      organizationId: string,
      permission: AuthzPermission,
    ): Promise<boolean>;
    /**
     * One batched resolution per organization, not one check per project — a
     * scoped check is ~4 queries, so a per-project fan-out would scale with
     * the organization's project count.
     */
    batchProjectPermissions(
      ctx: OrganizationTrpcContext,
      input: Readonly<{
        organizationId: string;
        projectIds: string[];
        projectTeamId: Record<string, string>;
        permission: AuthzPermission;
      }>,
    ): Promise<Map<string, boolean>>;
    /** Team- and organization-scoped bindings, direct or via a group. */
    listBindingsForSynthesis(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ orgIds: string[]; userId: string }>,
    ): Promise<AuthzBindingForSynthesis[]>;
    /**
     * A team with a member row synthesized for a user who reaches it through
     * a RoleBinding but carries no `TeamUser` row. Synchronous on purpose —
     * the application's organization service is wrapped by `traced()`, which
     * would turn a method call into a Promise and silently drop the members.
     */
    enrichTeamWithRoleBindings<
      T extends {
        id: string;
        members: {
          userId: string;
          teamId: string;
          role: TeamUserRole;
          assignedRoleId: string | null;
          assignedRole?: unknown;
          createdAt: Date;
          updatedAt: Date;
        }[];
        projects: { id: string }[];
      },
    >(
      team: T,
      userId: string,
      userRoleBindings: AuthzBindingForSynthesis[],
      organizationId: string,
    ): T;

    // -- the deployment ------------------------------------------------------
    /** The demo organization's user and project, or empty strings when unset. */
    demoProject(): Readonly<{ userId: string; projectId: string }>;
    /** Decrypts one stored credential column. */
    decryptStoredSecret(value: string): string;

    // -- the plan ------------------------------------------------------------
    /** Custom roles are an Enterprise capability. Throws; never softened. */
    assertCustomRolesAllowed(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ organizationId: string }>,
    ): Promise<void>;
    /** The audit trail is an Enterprise capability. Throws. */
    assertAuditLogsAllowed(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ organizationId: string }>,
    ): Promise<void>;
    /** Whether a role string names a custom role rather than a built-in one. */
    isCustomRole(role: string): boolean;

    // -- licence seats -------------------------------------------------------
    /** The shape every other member-limit refusal raises, so one modal opens. */
    fullMemberLimitMessage: string;
    /** Why a Lite Member may hold no team role above viewer. */
    liteMemberViewerOnlyMessage: string;
    /** The seat facts behind a re-enable refused for want of a seat. */
    asMemberSeatLimitReached(error: unknown): SeatLimitMeta | null;
    /** The seat facts behind an invitation refused for want of a seat. */
    asResourceLimitExceeded(error: unknown): ResourceLimitFacts | null;
    /** Whether a failure is the invitation service's missing-organization one. */
    isOrganizationNotFound(error: unknown): boolean;
    /** Tells the organization's administrators a limit was reached. */
    notifyResourceLimitReached(
      ctx: OrganizationTrpcContext,
      input: Readonly<{
        organizationId: string;
        limitType: string;
        current: number;
        max: number;
      }>,
    ): Promise<void>;
    /** Whether an organization role permits a given team role at all. */
    isTeamRoleAllowedForOrganizationRole(
      input: Readonly<{ organizationRole: OrganizationApiMemberRole; teamRole: string }>,
    ): boolean;
    /**
     * Refuses a built-in team-role change that would push the organization
     * past the member seats its licence covers. Throws.
     */
    assertTeamRoleChangeWithinSeatLimits(
      ctx: OrganizationTrpcContext,
      input: Readonly<{
        organizationId: string;
        teamId: string;
        userId: string;
      }>,
    ): Promise<void>;
    /** Refuses a role change addressed at a personal team. Throws. */
    assertNoPersonalTeamScope(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ teamId: string }>,
    ): Promise<void>;
    /** The team's organization, or null when the team does not exist. */
    tryGetTeamOrganizationId(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ teamId: string }>,
    ): Promise<string | null>;
    /** The member's organization role, or null when they are not a member. */
    tryGetOrganizationMemberRole(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ organizationId: string; userId: string }>,
    ): Promise<OrganizationApiMemberRole | null>;

    // -- invitations ---------------------------------------------------------
    createInvites(
      ctx: OrganizationTrpcContext,
      input: Readonly<{
        organizationId: string;
        invites: {
          email: string;
          teamIds?: string;
          teams?: { teamId: string; role: string; customRoleId?: string }[];
          role: OrganizationApiMemberRole;
        }[];
      }>,
    ): Promise<{
      organization: { members: unknown[] };
      invites: { invite: OrganizationInvite; emailNotSent: boolean }[];
    }>;
    revokeInvite(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ organizationId: string; inviteId: string }>,
    ): Promise<void>;
    /**
     * Throttled per INVITATION, because the thing being protected is the
     * recipient's inbox rather than this server. Throws when throttled.
     */
    assertInviteSendAllowed(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ inviteId: string }>,
    ): Promise<void>;
    resendInvite(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ organizationId: string; inviteId: string }>,
    ): Promise<{ invite: OrganizationInvite; emailNotSent: boolean }>;
    buildInviteAcceptUrl(inviteCode: string): string;
    listInvites(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ organizationId: string }>,
    ): Promise<ListedInvite[]>;
    tryGetInviteByCode(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ inviteCode: string }>,
    ): Promise<InviteWithOrganization | null>;
    /** PENDING / ACCEPTED / EXPIRED / REVOKED, expiry included. */
    resolveInviteDisplayStatus(invite: OrganizationInvite): InviteDisplayStatus;
    /**
     * Whether ANY of the signed-in user's VERIFIED identifiers holds the
     * invited address, and which one vouched. A user not yet on identifiers
     * falls back to the session-email comparison byte-for-byte.
     */
    matchInviteToAcceptor(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ inviteEmail: string; sessionEmail: string; userId: string }>,
    ): Promise<Readonly<{ matches: boolean; viaIdentifierId?: string | null }>>;
    /** The invited address, masked: an invite code is a bearer token. */
    maskInvitedAddress(email: string): string;
    applyInvite(
      ctx: OrganizationTrpcContext,
      input: Readonly<{
        userId: string;
        invite: InviteWithOrganization;
        viaIdentifierId?: string | null;
      }>,
    ): Promise<void>;
    findLandingProjectSlug(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ invite: InviteWithOrganization }>,
    ): Promise<string | null>;
    /** The revoked invitation and the missing one are the same answer. */
    inviteNotFoundError(): Error;
    /** Recoverable in one click, so it gets its own named refusal. */
    inviteExpiredError(): Error;
    /** Signed in as somebody else is a wrong turn, not a refusal. */
    inviteWrongAccountError(maskedEmail: string): Error;
    inviteAlreadyAcceptedMessage: string;
    inviteNotReadyMessage: string;

    // -- joining -------------------------------------------------------------
    /** A formal invitation ANSWERS the same person's open request. */
    resolveJoinRequestByInvitation(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ userId: string; organizationId: string; inviteId: string }>,
    ): Promise<void>;
    /** Accepting an invitation WITHDRAWS the same person's open request. */
    withdrawJoinRequestOnInvitationAccepted(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ userId: string; organizationId: string }>,
    ): Promise<void>;
    /** The user behind an invited address, when they already have an account. */
    tryFindUserIdByEmail(
      ctx: OrganizationTrpcContext,
      input: Readonly<{ email: string }>,
    ): Promise<string | null>;

    // -- the trail this surface leaves --------------------------------------
    trackServerEvent(
      input: Readonly<{
        userId: string;
        event: string;
        properties?: Readonly<Record<string, unknown>>;
      }>,
    ): void;
    fireTeamMemberInvitedNurturing(
      input: Readonly<{ userId: string; teamMemberCount: number; role: string }>,
    ): void;
    fireInviteAcceptedNurturing(
      input: Readonly<{
        userId: string;
        email: string;
        name?: string | null;
        organizationId: string;
        organizationName: string;
      }>,
    ): void;
    sendSlackSignupEvent(
      ctx: OrganizationTrpcContext,
      input: Readonly<{
        userName?: string | null;
        userEmail: string;
        organizationName: string;
      }>,
    ): Promise<void>;
    /** Never fatal: every caller below is on a non-fatal branch. */
    reportError(
      error: unknown,
      context?: Readonly<{
        tags?: Readonly<Record<string, string>>;
        extra?: Readonly<Record<string, unknown>>;
      }>,
    ): void;
  }>;

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

const ORGANIZATION_VIEW: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:view",
};

const ORGANIZATION_MANAGE: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:manage",
};

/** `organization:manage`, resolved from the team the change addresses. */
const ORGANIZATION_MANAGE_VIA_TEAM: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:manage",
  via: "teamId",
};

/**
 * The one opt-out this surface makes, and the same sentence for all three
 * procedures that make it: each runs before or across membership, so there is
 * no scope to check and no permission the caller could hold.
 */
const BEFORE_MEMBERSHIP: AuthzDeclaration = {
  kind: "no-permission",
  reason:
    "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
};

/**
 * The signed-in user, proven present. `protectedProcedure` has already
 * refused an anonymous caller, so this only narrows the type.
 */
function sessionUser(ctx: OrganizationTrpcContext): OrganizationTrpcSessionUser {
  const user = ctx.session?.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return user;
}

/** Installs the complete `organization.*` tRPC surface on a process-owned root. */
export class OrganizationTrpcApi {
  static create<
    TContext extends OrganizationTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TSignUpDataSchema extends z.ZodTypeAny,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: OrganizationTrpcProcedures<TContext, TOptions, TRoot>,
    ports: OrganizationTrpcPorts<TSignUpDataSchema>,
  ) {
    const { protected: procedure, policy, auditLogPolicy } = procedures;

    /**
     * The one input built here rather than in the contract: `signUpData` is a
     * schema the process supplies, so the shape cannot be closed over until it
     * arrives.
     */
    const createAndAssignInputSchema = z.object({
      orgName: z.string().optional(),
      phoneNumber: z.string().optional(),
      signUpData: ports.signUpDataSchema.optional(),
      primaryIntent: organizationIntentSchema.optional(),
    });

    /**
     * The contract owns the fields; the refinement is applied here because it
     * asks the process what a custom role looks like, which keeps one
     * definition of that rather than a second regex drifting beside it.
     */
    const updateTeamMemberRoleInputSchema =
      organizationApiUpdateTeamMemberRoleInputSchema.superRefine((data, issues) => {
        const hasCustom = ports.isCustomRole(data.role);

        if (hasCustom) {
          if (!data.customRoleId || data.customRoleId.trim() === "") {
            issues.addIssue({
              code: z.ZodIssueCode.custom,
              message: "customRoleId is required when using a custom role",
              path: ["customRoleId"],
            });
          }
        } else {
          if (data.customRoleId !== undefined) {
            issues.addIssue({
              code: z.ZodIssueCode.custom,
              message: "customRoleId must not be provided when using a built-in role",
              path: ["customRoleId"],
            });
          }
        }
      });

    return trpc.router({
      createAndAssign: policy(BEFORE_MEMBERSHIP)(
        procedure.input(createAndAssignInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const user = sessionUser(ctx);
        const result = await ctx.app.organizations.createAndAssign(
          {
            orgName: input.orgName,
            phoneNumber: input.phoneNumber,
            signUpData: input.signUpData as unknown as Record<string, unknown> | undefined,
            primaryIntent: input.primaryIntent,
            userDisplayName: user.name,
          },
          user,
        );

        return {
          success: true,
          organization: result.organization,
          team: result.team,
        };
      }),

      deleteMember: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiMemberScopeSchema),
      ).mutation(async ({ input, ctx }) => {
        // The self-removal guard lives in the service now; it refuses with
        // `cannot_remove_self`, which the handled-error middleware puts on the
        // wire for the client's code-keyed copy.
        await ctx.app.organizations.deleteMember(
          { organizationId: input.organizationId, userId: input.userId },
          sessionUser(ctx),
        );

        return { success: true };
      }),

      /**
       * Disables or re-enables a membership so an organization can reconcile
       * down to the seats its license covers. See seat-reconciliation.feature.
       *
       * The live browser sessions of a disabled member are revoked by the
       * membership write itself, not here: revoking a seat has to revoke the
       * session too, and doing it below the service keeps the REST surface
       * and this one on one path rather than two.
       */
      setMemberDisabled: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiSetMemberDisabledInputSchema),
      ).mutation(async ({ input, ctx }) => {
        try {
          await ctx.app.organizations.setMemberDisabled(
            {
              organizationId: input.organizationId,
              userId: input.userId,
              disabled: input.disabled,
            },
            sessionUser(ctx),
          );
        } catch (error) {
          const seatLimit = ports.asMemberSeatLimitReached(error);
          if (seatLimit) {
            // The same shape every other member-limit refusal throws, so the
            // client's global handler opens the limit modal with the real
            // numbers and its "Upgrade license" link, rather than this route
            // inventing copy of its own.
            throw new TRPCError({
              code: "FORBIDDEN",
              message: ports.fullMemberLimitMessage,
              cause: {
                limitType: seatLimit.limitType,
                current: seatLimit.current,
                max: seatLimit.max,
              },
            });
          }
          throw error;
        }

        return { success: true };
      }),

      getAll: policy(BEFORE_MEMBERSHIP)(procedure.input(organizationApiGetAllInputSchema)).query(
        async ({ ctx, input }) => {
          const isDemo = input?.isDemo ?? false;
          const userId = sessionUser(ctx).id;
          const demo = ports.demoProject();
          const demoProjectUserId = isDemo ? demo.userId : "";
          const demoProjectId = isDemo ? demo.projectId : "";

          const organizations = await ctx.app.organizations.getAllForUser(
            { isDemo, demoProjectUserId, demoProjectId },
            sessionUser(ctx),
          );

          // Fetch all team- and org-scoped RoleBindings for the user (direct or via group)
          // so we can synthesize team membership for users who have access only through groups.
          const orgIds = organizations.map((o) => o.id);
          const userRoleBindings =
            orgIds.length > 0 ? await ports.listBindingsForSynthesis(ctx, { orgIds, userId }) : [];

          // The plaintext S3 secret access key is only needed by the org/project
          // settings forms, which are organization:manage surfaces that round-trip
          // the stored value on save. Everyone else gets it redacted — the API
          // must not hand the decrypted secret to lite/viewer members just
          // because the UI happens not to render it.
          const manageableOrgIds = new Set<string>();
          // Decides the base-key redaction below. One batched resolution per org,
          // not one check per project — a scoped check is ~4 queries, so a
          // per-project fan-out would scale with the org's project count.
          const updatableProjectsByOrg = new Map<string, Map<string, boolean>>();
          for (const organization of organizations) {
            const canManage = await ports.probeOrganizationPermission(
              ctx,
              organization.id,
              "organization:manage",
            );
            if (canManage) manageableOrgIds.add(organization.id);

            const projectTeamId: Record<string, string> = {};
            for (const team of organization.teams) {
              for (const project of team.projects) {
                projectTeamId[project.id] = team.id;
              }
            }
            const projectIds = Object.keys(projectTeamId);
            if (projectIds.length === 0) continue;

            const updatableProjects = await ports.batchProjectPermissions(ctx, {
              organizationId: organization.id,
              projectIds,
              projectTeamId,
              permission: "project:update",
            });
            updatableProjectsByOrg.set(organization.id, updatableProjects);
          }

          for (const organization of organizations) {
            const canManage = manageableOrgIds.has(organization.id);
            for (const project of organization.teams.flatMap((team) => team.projects)) {
              if (project.s3AccessKeyId) {
                project.s3AccessKeyId = ports.decryptStoredSecret(project.s3AccessKeyId);
              }
              project.s3SecretAccessKey =
                canManage && project.s3SecretAccessKey
                  ? ports.decryptStoredSecret(project.s3SecretAccessKey)
                  : null;
              if (project.s3Endpoint) {
                project.s3Endpoint = ports.decryptStoredSecret(project.s3Endpoint);
              }
              // The base key is a project-level write credential. Same rule as the
              // S3 secret above: send it only to those who can change the project,
              // rather than relying on the UI not to render it. Demo projects
              // expose it to no one.
              const canUpdateProject =
                updatableProjectsByOrg.get(organization.id)?.get(project.id) ?? false;
              if (isDemo || !canUpdateProject) {
                project.apiKey = "";
              }
              // The LangWatchQL key is a control-plane secret: no client surface
              // reads it, so unlike the base key it is sent to no one at all.
              project.lwqlKey = "";
            }
          }
          for (const organization of organizations) {
            const isDemoOrg =
              isDemo &&
              organization.teams.some((team) =>
                team.projects.some((project) => project.id === demoProjectId),
              );

            organization.members = organization.members.filter(
              (member) => member.userId === userId || member.userId === demoProjectUserId,
            );
            if (organization.s3AccessKeyId) {
              organization.s3AccessKeyId = ports.decryptStoredSecret(organization.s3AccessKeyId);
            }
            organization.s3SecretAccessKey =
              manageableOrgIds.has(organization.id) && organization.s3SecretAccessKey
                ? ports.decryptStoredSecret(organization.s3SecretAccessKey)
                : null;
            if (organization.s3Endpoint) {
              organization.s3Endpoint = ports.decryptStoredSecret(organization.s3Endpoint);
            }

            // The Organization row still carries the dead Elasticsearch columns
            // (kept for deploy safety until a follow-up migration drops them).
            // Never ship the stored ciphertext / flag to clients.
            organization.elasticsearchNodeUrl = null;
            organization.elasticsearchApiKey = null;
            organization.useCustomElasticsearch = false;

            // A user can be an org admin via either the legacy OrganizationUser row
            // OR via an ORGANIZATION-scoped ADMIN RoleBinding (direct or via group).
            // Without this, users onboarded through the RoleBinding flow with no
            // OrganizationUser row are treated as external and lose access to every
            // team that lacks an explicit team/project binding.
            const isOrgAdminViaBinding = userRoleBindings.some(
              (b) =>
                b.organizationId === organization.id &&
                b.scopeType === "ORGANIZATION" &&
                b.role === "ADMIN",
            );
            // RoleBinding(scope=ORGANIZATION, role=ADMIN) is authoritative when present:
            // promote the user's exposed role so the frontend hook
            // `useOrganizationTeamProject().organizationRole` and downstream guards
            // (`withPermissionGuard("organization:manage")`) honor it. Without this,
            // a stale `OrganizationUser.role=MEMBER` row shadows a fresh ADMIN
            // RoleBinding, gating the admin out of /governance + /governance/*.
            // Backend RBAC paths already honor RoleBindings (`resolveOrganizationPermission`,
            // `requireApiKeyPermission`); this closes the page-guard / SSR-only drift.
            if (isOrgAdminViaBinding) {
              if (organization.members[0]) {
                organization.members[0].role = "ADMIN";
              } else {
                organization.members = [
                  {
                    userId,
                    organizationId: organization.id,
                    role: "ADMIN",
                  } as (typeof organization.members)[number],
                ];
              }
            }
            const isExternal =
              !isOrgAdminViaBinding &&
              organization.members[0]?.role !== "ADMIN" &&
              organization.members[0]?.role !== "MEMBER";

            organization.teams = organization.teams.filter((team) => {
              team.members = team.members.filter(
                (member) => member.userId === userId || member.userId === demoProjectUserId,
              );

              // RoleBinding is authoritative for team membership and role.
              // Always prefer a team-scoped RoleBinding over any stale TeamUser row,
              // since dual-writes to TeamUser have been removed.
              // Org-scoped bindings are intentionally excluded: org MEMBER/VIEWER bindings
              // only grant organization:view — they don't give team-level access.
              // Org admins are handled by the organizationRole === ADMIN shortcut in
              // the frontend hasPermission and backend resolveTeamPermission.
              //
              // NOTE: supplied as a port (not a service method) because the
              // application's organization service is wrapped by traced(), which
              // would turn this sync call into a Promise and silently drop
              // team.members.
              const enriched = ports.enrichTeamWithRoleBindings(
                team,
                userId,
                userRoleBindings,
                organization.id,
              );
              team.members = enriched.members;

              if (isDemoOrg) return true;
              return isExternal ? team.members.some((member) => member.userId === userId) : true;
            });

            if (isDemoOrg) {
              organization.teams = organization.teams.flatMap((team) => {
                if (team.projects.some((project) => project.id === demoProjectId)) {
                  team.projects = team.projects.filter((project) => project.id === demoProjectId);

                  team.members = team.members.filter(
                    (member) => member.userId === demoProjectUserId || member.userId === userId,
                  );
                  return [team];
                } else {
                  return [];
                }
              });
            }
          }

          return organizations;
        },
      ),

      update: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiUpdateInputSchema),
      ).mutation(async ({ input, ctx }) => {
        // The settings form round-trips every S3 field on save, so an absent
        // credential means "clear it". `updateSettings` is a partial update
        // where absent means "leave it alone", so the clearing is made
        // explicit here. `s3Bucket` keeps its historical leave-alone-if-absent
        // behavior. The ADR-057 trace-sharing disable cascade (revoke every
        // existing trace link across the org) lives in the service.
        await ctx.app.organizations.updateSettings({
          organizationId: input.organizationId,
          name: input.name,
          s3Endpoint: input.s3Endpoint ?? null,
          s3AccessKeyId: input.s3AccessKeyId ?? null,
          s3SecretAccessKey: input.s3SecretAccessKey ?? null,
          s3Bucket: input.s3Bucket,
          presenceEnabled: input.presenceEnabled,
          traceSharingEnabled: input.traceSharingEnabled,
          supportContact: input.supportContact,
          primaryIntent: input.primaryIntent,
        });

        return { success: true };
      }),

      /**
       * Stays at `organization:view` because non-admin pickers (annotation
       * queue assignment, trace participants, group dialogs) legitimately need
       * to enumerate org members by name. The full record contains member
       * emails, which are admin-surface PII — redacted on the way out for
       * non-admin callers below.
       */
      getOrganizationWithMembersAndTheirTeams: policy(ORGANIZATION_VIEW)(
        procedure.input(organizationApiWithMembersInputSchema),
      ).query(async ({ input, ctx }) => {
        const organization = await ctx.app.organizations.getOrganizationWithMembers(
          {
            organizationId: input.organizationId,
            includeDeactivated: input.includeDeactivated ?? false,
          },
          sessionUser(ctx),
        );

        if (!organization) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
          });
        }

        // PII guard for picker callers: when the caller doesn't have
        // organization:manage, null out other members' emails AND
        // strip their personal-workspace teamMemberships (existence of
        // someone else's personal workspace is itself private). The
        // caller's own email + own personal workspace stay visible.
        const callerHasManage = await ports.probeOrganizationPermission(
          ctx,
          input.organizationId,
          "organization:manage",
        );
        if (!callerHasManage) {
          const callerId = sessionUser(ctx).id;
          for (const m of organization.members ?? []) {
            if (m.user.id !== callerId) {
              m.user.email = null;
            }
            // Drop teamMembership rows that point at someone else's
            // personal workspace. The caller's own personal workspace
            // stays even when iterating someone else's memberships
            // (it's their team too — they belong to it).
            if (m.user.teamMemberships) {
              m.user.teamMemberships = m.user.teamMemberships.filter((tm) => {
                if (!tm.team.isPersonal) return true;
                return tm.team.ownerUserId === callerId;
              });
            }
          }
        }

        return organization;
      }),

      /**
       * Tightened from `organization:view` to manage — exposing one member's
       * full record (role assignments, team memberships) is an admin-surface
       * read, not a peer-context read. No TS callers currently depend on
       * member-role access to this procedure.
       */
      getMemberById: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiMemberScopeSchema),
      ).query(async ({ input, ctx }) => {
        const member = await ctx.app.organizations.getMemberById(
          { organizationId: input.organizationId, userId: input.userId },
          sessionUser(ctx),
        );

        if (!member) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found",
          });
        }

        return member;
      }),

      createInvites: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiCreateInvitesInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const user = sessionUser(ctx);
        const hasCustomRoleInvite = input.invites.some((invite) =>
          (invite.teams ?? []).some(
            (t) => typeof t.role === "string" && ports.isCustomRole(t.role),
          ),
        );
        if (hasCustomRoleInvite) {
          await ports.assertCustomRolesAllowed(ctx, {
            organizationId: input.organizationId,
          });
        }

        let created: Awaited<ReturnType<OrganizationTrpcPorts["createInvites"]>>;
        try {
          // Lenient validation keeps this procedure's historical form
          // behavior: invalid teams and custom roles drop the assignment or
          // the invite quietly instead of refusing the batch.
          created = await ports.createInvites(ctx, {
            organizationId: input.organizationId,
            invites: input.invites,
          });
        } catch (error) {
          if (ports.isOrganizationNotFound(error)) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Organization not found",
            });
          }
          const limit = ports.asResourceLimitExceeded(error);
          if (limit) {
            void ports
              .notifyResourceLimitReached(ctx, {
                organizationId: input.organizationId,
                limitType: limit.limitType,
                current: limit.current,
                max: limit.max,
              })
              .catch((failure) => ports.reportError(failure));

            throw new TRPCError({
              code: "FORBIDDEN",
              message: limit.message,
            });
          }
          throw error;
        }

        if (created.invites.length > 0) {
          // D11 x D12, invitation -> request: a formal invitation sent to
          // somebody with an open request ANSWERS it. The invitation carries
          // the role and the teams, which is the flow that owns them, so the
          // request resolves as approved-by-invitation rather than staying
          // open beside it. Silent when nothing is open, and never fatal — the
          // invitation is the durable outcome here.
          await Promise.all(
            created.invites.map(async (record) => {
              const invitedUserId = await ports.tryFindUserIdByEmail(ctx, {
                email: record.invite.email,
              });
              if (!invitedUserId) return;
              try {
                await ports.resolveJoinRequestByInvitation(ctx, {
                  userId: invitedUserId,
                  organizationId: record.invite.organizationId,
                  inviteId: record.invite.id,
                });
              } catch (error) {
                ports.reportError(error, {
                  tags: { organizationId: record.invite.organizationId },
                });
              }
            }),
          );

          ports.trackServerEvent({
            userId: user.id,
            event: "team_member_invited",
            properties: { inviteCount: created.invites.length },
          });

          const memberCount = created.organization.members.length + created.invites.length;
          for (const record of created.invites) {
            ports.fireTeamMemberInvitedNurturing({
              userId: user.id,
              teamMemberCount: memberCount,
              role: record.invite.role,
            });
          }
        }

        return created.invites;
      }),

      deleteInvite: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiInviteScopeSchema),
      ).mutation(async ({ input, ctx }) => {
        await ports.revokeInvite(ctx, {
          organizationId: input.organizationId,
          inviteId: input.inviteId,
        });
      }),

      resendInvite: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiInviteScopeSchema),
      ).mutation(async ({ input, ctx }) => {
        // Throttled per INVITATION, because the thing being protected is the
        // recipient's inbox rather than this server: an admin with three
        // invitations out may resend all three, and none of the three gets
        // mailed repeatedly. Checked before the resend so a refused attempt
        // leaves the live code alone — rotation is the old link's revocation,
        // and a throttled click must not quietly break the link already sent.
        await ports.assertInviteSendAllowed(ctx, { inviteId: input.inviteId });

        const { invite, emailNotSent } = await ports.resendInvite(ctx, {
          organizationId: input.organizationId,
          inviteId: input.inviteId,
        });
        return {
          invite,
          emailNotSent,
          inviteUrl: ports.buildInviteAcceptUrl(invite.inviteCode),
        };
      }),

      /**
       * Tightened from `organization:view` to manage — pending invites expose
       * admin intent (who's being added, with what role / to which teams).
       * MEMBER reading this is a leak. Both TS callers (settings/members,
       * SubscriptionPage) are admin-only surfaces.
       */
      getOrganizationPendingInvites: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiScopeSchema),
      ).query(async ({ input, ctx }) =>
        ports.listInvites(ctx, { organizationId: input.organizationId }),
      ),

      acceptInvite: policy(BEFORE_MEMBERSHIP)(
        procedure.input(organizationApiAcceptInviteInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const user = sessionUser(ctx);
        const invite = await ports.tryGetInviteByCode(ctx, {
          inviteCode: input.inviteCode,
        });

        // A revoked invitation reads exactly like a missing one on purpose:
        // the journey ends quietly, revealing nothing about the organization
        // or the inviter. Expired is different — it is recoverable (the
        // inviter resends in one click), so it gets its own named refusal.
        if (!invite || invite.status === "REVOKED") {
          throw ports.inviteNotFoundError();
        }

        if (!user.email) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You must be signed in to accept the invite",
          });
        }

        if (invite.status === "ACCEPTED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: ports.inviteAlreadyAcceptedMessage,
          });
        }

        if (ports.resolveInviteDisplayStatus(invite) === "EXPIRED") {
          throw ports.inviteExpiredError();
        }

        if (invite.status !== "PENDING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: ports.inviteNotReadyMessage,
          });
        }

        // Identifier-aware acceptance (D11): an invitation targets an address,
        // and ANY of the signed-in user's VERIFIED identifiers holding that
        // address vouches for them — password, Google, or the org's SSO. The
        // person invited by email who signed in with their Google account is
        // no longer a support ticket. A user not yet on identifiers answers
        // `null` and keeps the legacy session-email comparison byte-for-byte.
        const { matches: inviteEmailMatches, viaIdentifierId } = await ports.matchInviteToAcceptor(
          ctx,
          {
            inviteEmail: invite.email,
            sessionEmail: user.email,
            userId: user.id,
          },
        );
        // Signed in as somebody else is a wrong turn, not a refusal: the screen
        // names which account is wanted and offers the way back. The hint is
        // masked because an invite code is a bearer token — the landing already
        // declines to name the invited address, and a mismatch is not a hole to
        // read it through.
        if (!inviteEmailMatches) {
          throw ports.inviteWrongAccountError(ports.maskInvitedAddress(invite.email));
        }

        // No transaction: the invite's grants are ledger commands, so the
        // membership row has to be committed before they are emitted, and the
        // invite is only marked ACCEPTED once everything before it has landed
        // (a still-PENDING invite is one still to apply).
        await ports.applyInvite(ctx, {
          userId: user.id,
          invite,
          viaIdentifierId,
        });

        // D11 x D12, acceptance -> request: accepting an invitation withdraws
        // the same person's open request for this organization, so the
        // membership lands exactly once and the admins' panel empties itself.
        // Never fatal — the membership is the durable outcome, and a request
        // left open is answered by the next approval or by the expiry.
        try {
          await ports.withdrawJoinRequestOnInvitationAccepted(ctx, {
            userId: user.id,
            organizationId: invite.organizationId,
          });
        } catch (error) {
          ports.reportError(error, {
            tags: { organizationId: invite.organizationId },
          });
        }

        // Provision the user's Personal Workspace (Team.isPersonal +
        // Project.isPersonal) for this org. Idempotent — safe if a prior
        // invite already triggered it. Runs outside the invite tx so an
        // unexpected failure here doesn't roll the membership back; the
        // next login will retry via the lazy backfill in
        // `user.personalContext`.
        try {
          await ctx.app.organizations.ensurePersonalWorkspace(
            {
              organizationId: invite.organizationId,
              displayName: user.name,
              displayEmail: user.email,
            },
            user,
          );
        } catch (err) {
          // Non-fatal — capture and continue. Lazy backfill will recover
          // on the user's next session resolution. PostHog signal lets
          // operators catch systemic provisioning regressions (bad
          // migration, schema drift, Prisma constraint violation) before
          // users start complaining about missing personal workspaces.
          ports.reportError(err, {
            extra: {
              origin: "governance.acceptInvite",
              userId: user.id,
              organizationId: invite.organizationId,
            },
          });
        }

        void ports
          .sendSlackSignupEvent(ctx, {
            userName: user.name,
            userEmail: user.email,
            organizationName: invite.organization.name,
          })
          .catch((failure) => ports.reportError(failure));

        ports.fireInviteAcceptedNurturing({
          userId: user.id,
          email: user.email,
          name: user.name,
          organizationId: invite.organization.id,
          organizationName: invite.organization.name,
        });

        const projectSlug = await ports.findLandingProjectSlug(ctx, { invite });

        return {
          success: true,
          invite,
          project: projectSlug ? { slug: projectSlug } : null,
        };
      }),

      updateTeamMemberRole: policy(ORGANIZATION_MANAGE_VIA_TEAM)(
        procedure.input(updateTeamMemberRoleInputSchema),
      ).mutation(async ({ input, ctx }) => {
        await ports.assertNoPersonalTeamScope(ctx, { teamId: input.teamId });
        const inputIsCustomRole = ports.isCustomRole(input.role);

        if (inputIsCustomRole && input.customRoleId) {
          // Check enterprise plan before allowing custom role assignment
          const organizationId = await ports.tryGetTeamOrganizationId(ctx, {
            teamId: input.teamId,
          });
          if (!organizationId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Team not found",
            });
          }
          await ports.assertCustomRolesAllowed(ctx, { organizationId });
        } else if (!inputIsCustomRole) {
          // Built-in role path: check license limits for EXTERNAL users
          const organizationId = await ports.tryGetTeamOrganizationId(ctx, {
            teamId: input.teamId,
          });
          if (!organizationId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Team not found",
            });
          }

          const organizationRole = await ports.tryGetOrganizationMemberRole(ctx, {
            organizationId,
            userId: input.userId,
          });

          if (organizationRole === "EXTERNAL") {
            if (
              !ports.isTeamRoleAllowedForOrganizationRole({
                organizationRole: "EXTERNAL",
                teamRole: input.role,
              })
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: ports.liteMemberViewerOnlyMessage,
              });
            }

            await ports.assertTeamRoleChangeWithinSeatLimits(ctx, {
              organizationId,
              teamId: input.teamId,
              userId: input.userId,
            });
          }
        }

        await ctx.app.organizations.updateTeamMemberRole(
          {
            teamId: input.teamId,
            userId: input.userId,
            role: input.role,
            customRoleId: input.customRoleId,
          },
          sessionUser(ctx),
        );

        return { success: true };
      }),

      /**
       * Tightened from `organization:view` to manage — the full member list
       * with PII (emails) is admin-surface data. No TS callers currently
       * depend on this procedure; documented here so a future picker UX that
       * needs member names knows to use a basic-view variant rather than
       * re-loosening the permission.
       */
      getAllOrganizationMembers: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiScopeSchema),
      ).query(async ({ input, ctx }) =>
        ctx.app.organizations.getAllMembers({ organizationId: input.organizationId }),
      ),

      updateMemberRole: policy(ORGANIZATION_MANAGE)(
        procedure.input(organizationApiUpdateMemberRoleInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const user = sessionUser(ctx);
        // The whole orchestration (personal-workspace assertion, shared-team
        // scoping, seat classification, Enterprise gate for custom roles)
        // lives in the service so the REST surface runs the same rules.
        const { teamsLeftWithoutAdmin } = await ctx.app.organizations.changeMemberRole(
          {
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role,
            teamRoleUpdates: input.teamRoleUpdates,
            planUser: user,
          },
          user,
        );

        // Reported rather than refused: correcting a seat down to Viewer can take
        // away a shared team's only team-scoped admin, which is allowed because
        // organization admins administer every shared team anyway. Naming the
        // teams is what keeps the decision from being a silent one.
        return { success: true, teamsLeftWithoutAdmin };
      }),

      getAuditLogs: auditLogPolicy(procedure.input(organizationApiAuditLogsInputSchema)).query(
        async ({ ctx, input }) => {
          await ports.assertAuditLogsAllowed(ctx, {
            organizationId: input.organizationId,
          });

          return ctx.app.organizations.getAuditLogs({
            organizationId: input.organizationId,
            projectId: input.projectId,
            userId: input.userId,
            pageOffset: input.pageOffset,
            pageSize: input.pageSize,
            action: input.action,
            startDate: input.startDate,
            endDate: input.endDate,
            targetKind: input.targetKind,
            targetId: input.targetId,
          });
        },
      ),
    });
  }
}

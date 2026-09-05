import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository";
import type {
  OrganizationInviteMailPort,
  OrganizationInviteSeatCensusPort,
} from "../ports/invite.port";
import type { InviteSendThrottleService } from "../services/invite-send-throttle.service";

/**
 * The KSUID resource prefix a role binding is minted under, restated the way the membership repository
 * and the identifier adapter beside it restate it: the string is the stored id's shape, and it belongs
 * next to every writer that mints one rather than in a constants module a package cannot see.
 */
export const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/**
 * Duration in milliseconds before an invite expires (14 days, D11).
 * Resend is one click, so the window can be generous; the old 48-hour
 * window plus an ops-only resend was where invitations went to die.
 */
export const INVITE_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Ceiling on the batch-invite transaction, derived from the work it holds: the batch endpoint accepts 50 invites and {@link InviteService.persistInvites} issues
 * one duplicate check and one insert per invite on the single connection an interactive transaction owns, so 100 sequential indexed statements. At 200ms apiece,
 * which is already an unhappy database, that is 20 seconds; Prisma's 5s default fails the whole batch with P2028 well before a large batch is unhealthy.
 */
export const INVITE_BATCH_TXN_TIMEOUT_MS = 20_000;

/**
 * How long to wait for a connection before starting. Raised from Prisma's 2s
 * default for the same reason the dataset mutations raise it: a busy pool
 * should not fail a batch before it has done any work.
 */
export const INVITE_BATCH_TXN_MAX_WAIT_MS = 10_000;

export interface TeamAssignmentInput {
  teamId: string;
  role: TeamUserRole;
  customRoleId?: string;
}

/**
 * Input for creating an admin invite (immediate PENDING status).
 */
export interface CreateAdminInviteInput {
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments?: TeamAssignmentInput[];
}

/**
 * One requested invite for the {@link InviteService.createInvites} orchestrator. `teams` carries either built-in
 * team roles, `CUSTOM` with a `customRoleId`, or the `custom:{roleId}` string form the invite form sends;
 * `teamIds` is the legacy comma-separated form that assigns the default team role for the organization role.
 */
export interface CreateInvitesInviteInput {
  email: string;
  role: OrganizationUserRole;
  teamIds?: string;
  teams?: Array<{
    teamId: string;
    role: TeamUserRole | string;
    customRoleId?: string;
  }>;
}

/** The validated team side of one requested invite. */
export interface ResolvedInviteTeams {
  teamAssignments: TeamAssignmentInput[];
  teamIdsString: string;
}

/**
 * Input for creating a PAYMENT_PENDING invite (checkout flow).
 */
export interface CreatePaymentPendingInviteInput {
  email: string;
  role: OrganizationUserRole;
  organizationId: string;
  teamIds: string;
  teamAssignments?: TeamAssignmentInput[];
  subscriptionId: string;
}

/**
 * Everything the invitation service is composed FROM.
 */
export type InviteServiceDependencies = Readonly<{
  /** The invitations, and what an invitation is validated and settled against. */
  invites: OrganizationInviteRepository;
  /** The organization's seat census and the lite-seat rule. */
  seats: OrganizationInviteSeatCensusPort;
  /** Which plan the organization is on, and therefore how many seats it holds. */
  plans: PlanProvider;
  /** The ledger the accepted invitation's grants are written through. */
  grants: AuthzGrantsService;
  /**
   * Where assignability is defined. Required rather than optional: an
   * invitation validated against a different rule than `applyInvite` applies
   * would be accepted here and silently dropped on acceptance.
   */
  roles: RoleService;
  /** The shared per-invitation send window. */
  throttle: InviteSendThrottleService;
  /** This deployment's public origin, for the accept link. */
  baseHost: string;
  /**
   * The mail gateway, where the deployment composed one. Absent is supported:
   * every invitation still gets written and carries its accept URL, and the
   * caller is told `emailNotSent`.
   */
  mail?: OrganizationInviteMailPort | undefined;
}>;

/**
 * Service that encapsulates invite creation, validation, and acceptance
 * logic, extracted from the organization router.
 */

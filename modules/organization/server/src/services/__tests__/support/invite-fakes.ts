/**
 * In-memory fakes for the ports `InviteAcceptanceService`, `InviteLifecycleService`,
 * `InviteCreationService` and `InviteTeamAssignmentService` are composed from. Each stores
 * real state (a Map, a Set) rather than counting calls, so a test asserts the world the
 * services actually left behind.
 */
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type {
  AuthzAttachBindingsInput,
  AuthzAttachBindingsOutput,
  AuthzRevokeBindingsWhereInput,
  AuthzRevokeBindingsWhereOutput,
} from "@langwatch/authz-contract";
import type { LedgerActor } from "@langwatch/actor";
import type {
  Organization,
  OrganizationInvite,
  OrganizationUser,
  OrganizationUserRole,
  RoleBindingScopeType,
} from "@langwatch/organization-contract";
import type { RoleApi } from "@langwatch/role-contract";
import type {
  InviteWithOrganization,
  InviteWithRequester,
  OrganizationInviteRepository,
  WriteInviteInput,
} from "../../../repositories/organization-invite.repository.ts";
import {
  OrganizationInviteMailPort,
  OrganizationInviteSeatCensusPort,
  type OrganizationInviteRateLimitPort,
} from "../../../app/organization.infrastructure.ts";
import { InviteSendThrottleService } from "../../invite-send-throttle.service.ts";
import type { InviteServiceDependencies } from "../../../rules/invite-contracts.rules.ts";
import type { PlanProvider, Plan } from "@langwatch/entitlement-contract";

const unsupported = <Method>(name: string): Method =>
  (() => {
    throw new Error(`fake does not implement ${name}`);
  }) as Method;

/** One binding this fake's ledger currently holds, keyed by scope + principal + role. */
export type FakeBinding = {
  bindingId: string;
  userId: string;
  role: string;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  actor: LedgerActor;
};

/**
 * A real (if simplified) grants ledger: `attachBindings` adds, `revokeBindingsWhere` removes,
 * and the dedup key is content — (scope, user, role, customRoleId) — so attaching the exact
 * same binding twice is a no-op duplicate rather than a second row.
 */
export class FakeAuthzGrantsService implements AuthzGrantsService {
  private readonly bindings = new Map<string, FakeBinding>();

  private key(
    binding: Pick<FakeBinding, "scopeType" | "scopeId" | "userId" | "role" | "customRoleId">,
  ): string {
    return `${binding.scopeType}:${binding.scopeId}:${binding.userId}:${binding.role}:${binding.customRoleId ?? ""}`;
  }

  /** Every binding currently held for one user, for assertions. */
  bindingsFor(userId: string): FakeBinding[] {
    return Array.from(this.bindings.values()).filter((binding) => binding.userId === userId);
  }

  async attachBindings(args: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput> {
    const attached: string[] = [];
    const duplicates: string[] = [];
    for (const binding of args.bindings) {
      const userId = "userId" in binding.principal ? binding.principal.userId : "";
      const key = this.key({
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
        userId,
        role: binding.role,
        customRoleId: binding.customRoleId ?? null,
      });
      if (this.bindings.has(key)) {
        duplicates.push(binding.bindingId);
        continue;
      }
      this.bindings.set(key, {
        bindingId: binding.bindingId,
        userId,
        role: binding.role,
        customRoleId: binding.customRoleId ?? null,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
        actor: args.actor,
      });
      attached.push(binding.bindingId);
    }

    return { attached, duplicates };
  }

  async revokeBindingsWhere(
    args: AuthzRevokeBindingsWhereInput,
  ): Promise<AuthzRevokeBindingsWhereOutput> {
    let removed = 0;
    for (const [key, binding] of this.bindings) {
      if (
        binding.userId === args.where.userId &&
        binding.scopeType === args.where.scopeType &&
        binding.scopeId === args.where.scopeId
      ) {
        this.bindings.delete(key);
        removed++;
      }
    }

    return removed;
  }

  attach = unsupported<AuthzGrantsService["attach"]>("attach");
  update = unsupported<AuthzGrantsService["update"]>("update");
  revoke = unsupported<AuthzGrantsService["revoke"]>("revoke");
  replace = unsupported<AuthzGrantsService["replace"]>("replace");
  offboard = unsupported<AuthzGrantsService["offboard"]>("offboard");
  invalidateOrganization =
    unsupported<AuthzGrantsService["invalidateOrganization"]>("invalidateOrganization");
  attachResourceGrant =
    unsupported<AuthzGrantsService["attachResourceGrant"]>("attachResourceGrant");
  revokeResourceGrants =
    unsupported<AuthzGrantsService["revokeResourceGrants"]>("revokeResourceGrants");
  changeBindingRole = unsupported<AuthzGrantsService["changeBindingRole"]>("changeBindingRole");
  revokeBindings = unsupported<AuthzGrantsService["revokeBindings"]>("revokeBindings");
  offboardMember = unsupported<AuthzGrantsService["offboardMember"]>("offboardMember");
  defineRole = unsupported<AuthzGrantsService["defineRole"]>("defineRole");
  deleteRole = unsupported<AuthzGrantsService["deleteRole"]>("deleteRole");
  createBinding = unsupported<AuthzGrantsService["createBinding"]>("createBinding");
  updateBinding = unsupported<AuthzGrantsService["updateBinding"]>("updateBinding");
  deleteBinding = unsupported<AuthzGrantsService["deleteBinding"]>("deleteBinding");
  applyMemberBindings =
    unsupported<AuthzGrantsService["applyMemberBindings"]>("applyMemberBindings");
}

/** Seeds the fake repository with one invite row. */
export type SeedInvite = OrganizationInvite;

/**
 * The invitation rows, the memberships an acceptance writes, and the handful of organization
 * facts the four services under test read — all in one Map/Set-backed store per test.
 */
export class FakeOrganizationInviteRepository implements OrganizationInviteRepository {
  private readonly invitesById = new Map<string, OrganizationInvite>();
  private readonly memberships = new Set<string>();
  private readonly organizations = new Map<string, Organization>();
  private adminEmailsByOrganization = new Map<string, string[]>();
  private nextId = 1;

  seedAdminEmails({ organizationId, emails }: { organizationId: string; emails: string[] }): void {
    this.adminEmailsByOrganization.set(organizationId, emails);
  }

  seedInvite(invite: SeedInvite): void {
    this.invitesById.set(invite.id, invite);
  }

  seedOrganization(organization: Organization): void {
    this.organizations.set(organization.id, organization);
  }

  seedMembership({ userId, organizationId }: { userId: string; organizationId: string }): void {
    this.memberships.add(`${userId}:${organizationId}`);
  }

  getInvite(inviteId: string): OrganizationInvite | undefined {
    return this.invitesById.get(inviteId);
  }

  allInvites(): OrganizationInvite[] {
    return Array.from(this.invitesById.values());
  }

  hasMembershipState({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): boolean {
    return this.memberships.has(`${userId}:${organizationId}`);
  }

  async withTransaction<T>(
    write: (transaction: OrganizationInviteRepository) => Promise<T>,
  ): Promise<T> {
    return write(this);
  }

  async claimInviteForAcceptance({
    inviteId,
    organizationId,
    inviteCode,
    acceptedByUserId,
  }: {
    inviteId: string;
    organizationId: string;
    inviteCode: string;
    acceptedByUserId: string;
    acceptedViaIdentifierId: string | null;
  }): Promise<number> {
    const invite = this.invitesById.get(inviteId);
    const notExpired =
      invite?.expiration === null || (invite?.expiration ?? new Date(0)) > new Date();
    if (
      !invite ||
      invite.organizationId !== organizationId ||
      invite.inviteCode !== inviteCode ||
      invite.status !== "PENDING" ||
      !notExpired
    ) {
      return 0;
    }

    this.invitesById.set(inviteId, {
      ...invite,
      status: "ACCEPTED",
      acceptedByUserId,
    });

    return 1;
  }

  async addMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
  }): Promise<void> {
    this.memberships.add(`${userId}:${organizationId}`);
  }

  async tryFindInviteStatus({
    inviteId,
  }: {
    inviteId: string;
  }): Promise<{ status: string } | null> {
    const invite = this.invitesById.get(inviteId);

    return invite ? { status: invite.status } : null;
  }

  async hasMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.memberships.has(`${userId}:${organizationId}`);
  }

  async tryFindOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Organization | null> {
    return this.organizations.get(organizationId) ?? null;
  }

  async createPendingInvite(input: WriteInviteInput): Promise<OrganizationInvite> {
    const invite: OrganizationInvite = {
      id: `invite-${this.nextId++}`,
      email: input.email,
      inviteCode: input.inviteCode,
      expiration: input.expiration,
      status: "PENDING",
      organizationId: input.organizationId,
      teamIds: input.teamIds,
      teamAssignments: (input.teamAssignments as OrganizationInvite["teamAssignments"]) ?? null,
      role: input.role,
      requestedBy: null,
      subscriptionId: null,
      acceptedByUserId: null,
      acceptedViaIdentifierId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.invitesById.set(invite.id, invite);

    return invite;
  }

  async createPaymentPendingInvite(
    input: WriteInviteInput & { subscriptionId: string },
  ): Promise<OrganizationInvite> {
    const invite: OrganizationInvite = {
      id: `invite-${this.nextId++}`,
      email: input.email,
      inviteCode: input.inviteCode,
      expiration: input.expiration,
      status: "PAYMENT_PENDING",
      organizationId: input.organizationId,
      teamIds: input.teamIds,
      teamAssignments: (input.teamAssignments as OrganizationInvite["teamAssignments"]) ?? null,
      role: input.role,
      requestedBy: null,
      subscriptionId: input.subscriptionId,
      acceptedByUserId: null,
      acceptedViaIdentifierId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.invitesById.set(invite.id, invite);

    return invite;
  }

  async findPaymentPendingInvites({
    subscriptionId,
    organizationId,
  }: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization[]> {
    return Array.from(this.invitesById.values())
      .filter(
        (invite) =>
          invite.subscriptionId === subscriptionId &&
          invite.organizationId === organizationId &&
          invite.status === "PAYMENT_PENDING",
      )
      .map((invite) => ({
        ...invite,
        organization: this.organizations.get(invite.organizationId) ?? null,
      }));
  }

  async approvePaymentPendingInvite({
    inviteId,
    organizationId,
    expiration,
  }: {
    inviteId: string;
    organizationId: string;
    expiration: Date;
  }): Promise<OrganizationInvite> {
    const invite = this.invitesById.get(inviteId);
    if (!invite || invite.organizationId !== organizationId) {
      throw new Error("fake: invite not found for approvePaymentPendingInvite");
    }
    const updated: OrganizationInvite = { ...invite, status: "PENDING", expiration };
    this.invitesById.set(inviteId, updated);

    return updated;
  }

  async tryFindInviteByCodeWithOrganization({
    inviteCode,
  }: {
    inviteCode: string;
  }): Promise<InviteWithOrganization | null> {
    const invite = Array.from(this.invitesById.values()).find(
      (candidate) => candidate.inviteCode === inviteCode,
    );

    return invite
      ? { ...invite, organization: this.organizations.get(invite.organizationId) ?? null }
      : null;
  }

  async findAdminEmails({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.adminEmailsByOrganization.get(organizationId) ?? [];
  }

  tryFindOpenInviteForEmail = unsupported<
    OrganizationInviteRepository["tryFindOpenInviteForEmail"]
  >("tryFindOpenInviteForEmail");
  tryFindMemberEmail =
    unsupported<OrganizationInviteRepository["tryFindMemberEmail"]>("tryFindMemberEmail");
  findTeamIdsInOrganization = unsupported<
    OrganizationInviteRepository["findTeamIdsInOrganization"]
  >("findTeamIdsInOrganization");
  findCustomRolePermissions = unsupported<
    OrganizationInviteRepository["findCustomRolePermissions"]
  >("findCustomRolePermissions");
  tryFindOrganizationWithMembers = unsupported<
    OrganizationInviteRepository["tryFindOrganizationWithMembers"]
  >("tryFindOrganizationWithMembers");
  tryFindPersonalTeamInScopes = unsupported<
    OrganizationInviteRepository["tryFindPersonalTeamInScopes"]
  >("tryFindPersonalTeamInScopes");
  findListableInvites =
    unsupported<OrganizationInviteRepository["findListableInvites"]>("findListableInvites");
  revokeOpenInvite =
    unsupported<OrganizationInviteRepository["revokeOpenInvite"]>("revokeOpenInvite");
  tryFindInviteWithOrganization = unsupported<
    OrganizationInviteRepository["tryFindInviteWithOrganization"]
  >("tryFindInviteWithOrganization");
  rotateInviteCode =
    unsupported<OrganizationInviteRepository["rotateInviteCode"]>("rotateInviteCode");
  tryFindProjectSlugForTeams = unsupported<
    OrganizationInviteRepository["tryFindProjectSlugForTeams"]
  >("tryFindProjectSlugForTeams");
  tryFindProjectSlugInOrganization = unsupported<
    OrganizationInviteRepository["tryFindProjectSlugInOrganization"]
  >("tryFindProjectSlugInOrganization");
  tryFindPendingInviteForEmail = unsupported<
    OrganizationInviteRepository["tryFindPendingInviteForEmail"]
  >("tryFindPendingInviteForEmail");
}

/** All roles named are assignable, unless a test seeds a narrower answer. */
export class FakeRoleService implements Pick<RoleApi, "filterAssignableRoles"> {
  constructor(private readonly assignableRoleIds: Set<string> | null = null) {}

  async filterAssignableRoles({ roleIds }: { roleIds: string[] }): Promise<string[]> {
    if (this.assignableRoleIds === null) {
      return roleIds;
    }

    return roleIds.filter((id) => this.assignableRoleIds!.has(id));
  }
}

/** A per-key sliding window, close enough to the real limiter to test the throttle honestly. */
export class FakeInviteRateLimitPort implements OrganizationInviteRateLimitPort {
  private readonly sends = new Map<string, number[]>();

  async limit({
    key,
    windowSeconds,
    max,
  }: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const recent = (this.sends.get(key) ?? []).filter((sentAt) => now - sentAt < windowMs);

    if (recent.length >= max) {
      return { allowed: false, resetAt: recent[0]! + windowMs };
    }

    recent.push(now);
    this.sends.set(key, recent);

    return { allowed: true, resetAt: now + windowMs };
  }
}

export function makeOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    name: "Acme",
    phoneNumber: null,
    slug: "acme",
    createdAt: new Date(),
    updatedAt: new Date(),
    usageSpendingMaxLimit: null,
    maxSessionDurationDays: 30,
    mfaRequired: false,
    signupData: null,
    signedDPA: false,
    elasticsearchNodeUrl: null,
    elasticsearchApiKey: null,
    useCustomElasticsearch: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    useCustomS3: false,
    sentPlanLimitAlert: null,
    ssoDomain: null,
    ssoProvider: null,
    domainJoin: "NONE",
    joinDomains: [],
    presenceEnabled: false,
    traceSharingEnabled: false,
    supportContact: null,
    primaryIntent: null,
    promoCode: null,
    stripeCustomerId: null,
    currency: "USD",
    ...overrides,
  } as Organization;
}

export function makeInvite(overrides: Partial<OrganizationInvite> = {}): OrganizationInvite {
  return {
    id: "invite-seed-1",
    email: "sam@acme.com",
    inviteCode: "code-seed-1",
    expiration: new Date(Date.now() + 86_400_000),
    status: "PENDING",
    organizationId: "org-1",
    teamIds: "team-1",
    teamAssignments: null,
    role: "MEMBER",
    requestedBy: "user-inviter",
    subscriptionId: null,
    acceptedByUserId: null,
    acceptedViaIdentifierId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OrganizationInvite;
}

/** No seats port composed: every organization is unlimited unless a test overrides it. */
export class FakeSeatCensusPort implements OrganizationInviteSeatCensusPort {
  constructor(
    private readonly fullMembers = 0,
    private readonly liteMembers = 0,
  ) {}

  async getMemberCount(): Promise<number> {
    return this.fullMembers;
  }

  async getMembersLiteCount(): Promise<number> {
    return this.liteMembers;
  }

  isViewOnlyCustomRole(): boolean {
    return true;
  }
}

/** An unlimited plan, unless a test builds its own `Plan`. */
export function makePlanProvider(plan: Partial<Plan> = {}): PlanProvider {
  const resolved: Plan = {
    planSource: "free",
    type: "free",
    name: "Free",
    free: true,
    maxMembers: 1_000_000,
    maxMembersLite: 1_000_000,
    maxMessagesPerMonth: 1_000_000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...plan,
  };

  return { getActivePlan: async () => resolved };
}

/** Records every invite email this fake was asked to send, never actually sending anything. */
export class FakeInviteMailPort implements OrganizationInviteMailPort {
  readonly sentInvites: Array<{ email: string; acceptInviteUrl: string }> = [];
  readonly sentReRequests: Array<{ adminEmail: string; invitedEmail: string }> = [];

  async sendInvite(input: Parameters<OrganizationInviteMailPort["sendInvite"]>[0]): Promise<void> {
    this.sentInvites.push({ email: input.email, acceptInviteUrl: input.acceptInviteUrl });
  }

  async sendInviteReRequest(
    input: Parameters<OrganizationInviteMailPort["sendInviteReRequest"]>[0],
  ): Promise<void> {
    this.sentReRequests.push({ adminEmail: input.adminEmail, invitedEmail: input.invitedEmail });
  }
}

/**
 * A full `InviteServiceDependencies` wired to in-memory fakes, so a test only overrides the
 * one or two collaborators its guarantee actually reaches.
 */
export function makeInviteDeps(
  overrides: Partial<InviteServiceDependencies> = {},
): InviteServiceDependencies {
  return {
    invites: new FakeOrganizationInviteRepository(),
    seats: new FakeSeatCensusPort(),
    plans: makePlanProvider(),
    grants: new FakeAuthzGrantsService(),
    roles: new FakeRoleService(),
    throttle: InviteSendThrottleService.create(new FakeInviteRateLimitPort()),
    baseHost: "https://app.langwatch.ai",
    ...overrides,
  };
}

export type { OrganizationUser, InviteWithRequester };

import type { GrantScopeTier } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import {
  InviteNotFoundError,
  OrganizationNotFoundError,
  OrganizationUserRole,
  type Organization,
  type OrganizationInvite,
  type OrganizationJsonValue,
  type OrganizationUser,
} from "@langwatch/organization-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  DEVELOPER_ADMISSION_AUDIT_ACTION,
  type DeveloperAdmissionVia,
} from "../../rules/admission-audit.rules.ts";
import {
  OrganizationInviteRepository,
  type InviteWithOrganization,
  type InviteWithRequester,
  type WriteInviteInput,
} from "../organization-invite.repository.ts";
import {
  organizationOfRow,
  type MemoryOrganizationDatabase,
  type MemoryOrganizationInviteRow,
} from "./memory.organization.database.ts";
import { MemoryPersonalTeamScopeRepository } from "./memory.personal-team-scope.repository.ts";

/** Whether an invite's expiry is still ahead of now; no expiry never lapses. */
function isUnexpired(invite: MemoryOrganizationInviteRow, now: Instant): boolean {
  return invite.expiration === null || invite.expiration.epochMilliseconds > now.epochMilliseconds;
}

function sameAddress(left: string | null, right: string): boolean {
  return left !== null && left.toLowerCase() === right.toLowerCase();
}

/**
 * In-memory `OrganizationInviteRepository` over the shared organization tables. A
 * transaction is the repository itself: one writer, nothing to race.
 */
export class MemoryOrganizationInviteRepository extends OrganizationInviteRepository {
  static create(options: {
    memory: MemoryOrganizationDatabase;
  }): MemoryOrganizationInviteRepository {
    return new MemoryOrganizationInviteRepository(options.memory);
  }

  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  withTransaction<T>(write: (transaction: OrganizationInviteRepository) => Promise<T>): Promise<T> {
    return write(this);
  }

  async hasOpenInviteForEmail(input: { email: string; organizationId: string }): Promise<boolean> {
    const now = nowInstant();
    return this.#invitesOf(input.organizationId).some(
      (invite) =>
        sameAddress(invite.email, input.email.trim()) &&
        (invite.status === "PENDING" || invite.status === "PAYMENT_PENDING") &&
        isUnexpired(invite, now),
    );
  }

  async findMemberEmails(input: { organizationId: string; emails: string[] }): Promise<string[]> {
    return this.#membersOf(input.organizationId).flatMap((member) => {
      const email = this.memory.users.get(member.userId)?.email ?? null;
      return input.emails.some((wanted) => sameAddress(email, wanted)) ? [email ?? ""] : [];
    });
  }

  async findTeamIdsInOrganization(input: {
    teamIds: string[];
    organizationId: string;
  }): Promise<string[]> {
    return input.teamIds.filter(
      (teamId) => this.memory.teams.get(teamId)?.organizationId === input.organizationId,
    );
  }

  async findCustomRolePermissions(input: {
    organizationId: string;
  }): Promise<{ id: string; permissions: unknown }[]> {
    return [...this.memory.customRoles.values()]
      .filter((role) => role.organizationId === input.organizationId)
      .map((role) => ({ id: role.id, permissions: role.permissions }));
  }

  async getOrganization(input: { organizationId: string }): Promise<Organization> {
    const row = this.memory.organizations.get(input.organizationId);
    if (!row) throw new OrganizationNotFoundError();
    return organizationOfRow(row);
  }

  async getOrganizationWithMembers(input: {
    organizationId: string;
  }): Promise<Organization & { members: OrganizationUser[] }> {
    const organization = await this.getOrganization(input);
    return {
      ...organization,
      members: this.#membersOf(input.organizationId).map((member) => ({
        userId: member.userId,
        organizationId: member.organizationId,
        role: member.role,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        departmentId: member.departmentId ?? null,
        disabledAt: member.disabledAt,
      })),
    };
  }

  findPersonalTeamsInScopes(input: {
    scopes: { scopeType: GrantScopeTier; scopeId: string }[];
  }): Promise<{ name: string }[]> {
    return MemoryPersonalTeamScopeRepository.create({
      memory: this.memory,
    }).findPersonalTeamsInScopes(input);
  }

  async createPendingInvite(input: WriteInviteInput): Promise<OrganizationInvite> {
    return this.#write({ ...input, status: "PENDING", subscriptionId: null });
  }

  async createPaymentPendingInvite(
    input: WriteInviteInput & { subscriptionId: string },
  ): Promise<OrganizationInvite> {
    return this.#write({ ...input, status: "PAYMENT_PENDING" });
  }

  async findListableInvites(input: { organizationId: string }): Promise<InviteWithRequester[]> {
    return this.#invitesOf(input.organizationId)
      .filter((invite) => invite.status === "PENDING" || invite.status === "REVOKED")
      .toSorted((a, b) => b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds)
      .map((invite) => {
        const requester = invite.requestedBy
          ? this.memory.users.get(invite.requestedBy)
          : undefined;
        return {
          ...inviteOfRow(invite),
          requestedByUser: requester
            ? { id: requester.id, name: requester.name, email: requester.email }
            : null,
        };
      });
  }

  async revokeOpenInvite(input: { inviteId: string; organizationId: string }): Promise<number> {
    const invite = this.#inviteIn(input);
    if (!invite || (invite.status !== "PENDING" && invite.status !== "PAYMENT_PENDING")) return 0;
    this.#touch(invite, { status: "REVOKED" });
    return 1;
  }

  async getInviteWithOrganization(input: {
    inviteId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization> {
    const invite = this.#inviteIn(input);
    if (!invite) throw new InviteNotFoundError("Invitation not found");
    return this.#withOrganization(invite);
  }

  async rotateInviteCode(input: {
    inviteId: string;
    organizationId: string;
    expectedInviteCode: string;
    inviteCode: string;
    expiration: Instant;
  }): Promise<number> {
    const invite = this.#inviteIn(input);
    if (invite?.status !== "PENDING" || invite.inviteCode !== input.expectedInviteCode) return 0;
    this.#touch(invite, { inviteCode: input.inviteCode, expiration: input.expiration });
    return 1;
  }

  async extendInviteExpiration(input: {
    inviteId: string;
    organizationId: string;
    expiration: Instant;
  }): Promise<number> {
    const invite = this.#inviteIn(input);
    if (invite?.status !== "PENDING") return 0;
    this.#touch(invite, { expiration: input.expiration });
    return 1;
  }

  async getInviteByCodeWithOrganization(input: {
    inviteCode: string;
  }): Promise<InviteWithOrganization> {
    const invite = [...this.memory.invites.values()].find(
      (candidate) => candidate.inviteCode === input.inviteCode,
    );
    if (!invite) throw new InviteNotFoundError("Invitation not found");
    return this.#withOrganization(invite);
  }

  async findAdminEmails(input: { organizationId: string }): Promise<string[]> {
    return this.#membersOf(input.organizationId)
      .filter((member) => member.role === OrganizationUserRole.ADMIN)
      .flatMap((member) => {
        const email = this.memory.users.get(member.userId)?.email;
        return email ? [email] : [];
      });
  }

  async findProjectSlugsForTeams(input: { teamIds: string[] }): Promise<string[]> {
    return [...this.memory.projects.values()]
      .filter((project) => input.teamIds.includes(project.teamId) && project.archivedAt === null)
      .map((project) => project.slug);
  }

  async findProjectSlugsInOrganization(input: { organizationId: string }): Promise<string[]> {
    return [...this.memory.projects.values()]
      .filter((project) => {
        const team = this.memory.teams.get(project.teamId);
        return (
          project.archivedAt === null &&
          team?.organizationId === input.organizationId &&
          team.archivedAt === null
        );
      })
      .map((project) => project.slug);
  }

  async getPendingInviteForEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<OrganizationInvite> {
    const now = nowInstant();
    const invite = this.#invitesOf(input.organizationId).find(
      (candidate) =>
        sameAddress(candidate.email, input.email) &&
        candidate.status === "PENDING" &&
        isUnexpired(candidate, now),
    );
    if (!invite) throw new InviteNotFoundError();
    return inviteOfRow(invite);
  }

  async claimInviteForAcceptance(input: {
    inviteId: string;
    organizationId: string;
    inviteCode: string;
    acceptedByUserId: string;
    acceptedViaIdentifierId: string | null;
  }): Promise<number> {
    const invite = this.#inviteIn(input);
    if (
      invite?.status !== "PENDING" ||
      invite.inviteCode !== input.inviteCode ||
      !isUnexpired(invite, nowInstant())
    ) {
      return 0;
    }
    this.#touch(invite, {
      status: "ACCEPTED",
      acceptedByUserId: input.acceptedByUserId,
      acceptedViaIdentifierId: input.acceptedViaIdentifierId,
    });
    return 1;
  }

  async addMembership(input: {
    userId: string;
    organizationId: string;
    role: OrganizationUserRole;
    admission?: { inviteId: string; actorUserId: string | null };
  }): Promise<void> {
    if (await this.hasMembership(input)) return;
    const now = nowInstant();
    this.memory.organizationUsers.push({
      userId: input.userId,
      organizationId: input.organizationId,
      role: input.role,
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    });
    // A Developer gets no grant to audit, so its admission is recorded here (ADR-171).
    if (input.role !== OrganizationUserRole.DEVELOPER || !input.admission) return;
    const via: DeveloperAdmissionVia = "invite";
    this.memory.auditLogs.push({
      id: generate("auditlog").toString(),
      createdAt: now,
      userId: input.userId,
      actorUserId: input.admission.actorUserId,
      organizationId: input.organizationId,
      projectId: null,
      action: DEVELOPER_ADMISSION_AUDIT_ACTION,
      metadata: { seat: input.role, inviteId: input.admission.inviteId, via },
      payload: null,
      ipAddress: null,
      userAgent: null,
      error: null,
      args: null,
      targetKind: null,
      targetId: null,
      before: null,
      after: null,
    });
  }

  async getInviteStatus(input: { inviteId: string }): Promise<{ status: string }> {
    const invite = this.memory.invites.get(input.inviteId);
    if (!invite) throw new InviteNotFoundError();
    return { status: invite.status };
  }

  async hasMembership(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.memory.organizationUsers.some(
      (member) => member.userId === input.userId && member.organizationId === input.organizationId,
    );
  }

  async findPaymentPendingInvites(input: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<InviteWithOrganization[]> {
    return this.#invitesOf(input.organizationId)
      .filter(
        (invite) =>
          invite.subscriptionId === input.subscriptionId && invite.status === "PAYMENT_PENDING",
      )
      .map((invite) => this.#withOrganization(invite));
  }

  async deletePaymentPendingInvites(input: {
    organizationId: string;
    subscriptionIds: readonly string[];
  }): Promise<number> {
    const doomed = this.#invitesOf(input.organizationId).filter(
      (invite) =>
        invite.status === "PAYMENT_PENDING" &&
        invite.subscriptionId !== null &&
        input.subscriptionIds.includes(invite.subscriptionId),
    );
    for (const invite of doomed) this.memory.invites.delete(invite.id);
    return doomed.length;
  }

  async approvePaymentPendingInvite(input: {
    inviteId: string;
    organizationId: string;
    expiration: Instant;
  }): Promise<OrganizationInvite> {
    const invite = this.#inviteIn(input);
    if (!invite) throw new InviteNotFoundError();
    this.#touch(invite, { status: "PENDING", expiration: input.expiration });
    return inviteOfRow(invite);
  }

  #write(
    input: WriteInviteInput & {
      status: MemoryOrganizationInviteRow["status"];
      subscriptionId: string | null;
    },
  ): OrganizationInvite {
    const now = nowInstant();
    const row: MemoryOrganizationInviteRow = {
      id: generate("organizationinvite").toString(),
      email: input.email,
      inviteCode: input.inviteCode,
      expiration: input.expiration,
      status: input.status,
      organizationId: input.organizationId,
      teamIds: input.teamIds,
      teamAssignments: (input.teamAssignments ?? null) as OrganizationJsonValue | null,
      role: input.role,
      requestedBy: input.requestedBy ?? null,
      subscriptionId: input.subscriptionId,
      acceptedByUserId: null,
      acceptedViaIdentifierId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.memory.invites.set(row.id, row);
    return inviteOfRow(row);
  }

  #touch(invite: MemoryOrganizationInviteRow, change: Partial<MemoryOrganizationInviteRow>): void {
    Object.assign(invite, change, { updatedAt: nowInstant() });
  }

  #inviteIn(input: {
    inviteId: string;
    organizationId: string;
  }): MemoryOrganizationInviteRow | undefined {
    const invite = this.memory.invites.get(input.inviteId);
    return invite?.organizationId === input.organizationId ? invite : undefined;
  }

  #invitesOf(organizationId: string): MemoryOrganizationInviteRow[] {
    return [...this.memory.invites.values()].filter(
      (invite) => invite.organizationId === organizationId,
    );
  }

  #membersOf(organizationId: string) {
    return this.memory.organizationUsers.filter(
      (member) => member.organizationId === organizationId,
    );
  }

  #withOrganization(invite: MemoryOrganizationInviteRow): InviteWithOrganization {
    const organization = this.memory.organizations.get(invite.organizationId);
    return {
      ...inviteOfRow(invite),
      organization: organization ? organizationOfRow(organization) : null,
    };
  }
}

/** A copy, so a caller holding the answer never writes through to the table. */
function inviteOfRow(row: MemoryOrganizationInviteRow): OrganizationInvite {
  return { ...row };
}

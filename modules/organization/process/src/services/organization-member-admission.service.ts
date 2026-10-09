import type { LedgerActor } from "@langwatch/authorization";
import { newAuthzGrantId, type AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  CannotRemoveLastAdminError,
  CannotRemoveSelfError,
  OrganizationUserRole,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type { DeveloperAdmissionVia } from "../rules/admission-audit.rules.ts";

/** The grant half of an admission, answered by the authorization peer. */
export type OrganizationAdmissions = Pick<AuthzApi, "attachBindings" | "completeAdmission">;

/** Records a removed member's archived personal teams; project archives their projects (§9). */
export interface PersonalWorkspaceArchiveNotice {
  personalWorkspaceArchived(input: {
    organizationId: string;
    userId: string;
    teamIds: string[];
  }): Promise<void>;
}

/** Admitting a member on the joiner seat, and removing one without orphaning the organization. */
export class OrganizationMemberAdmissionService {
  static create(dependencies: {
    repository: OrganizationMembershipRepository;
    admissions: OrganizationAdmissions;
    workspaceNotices: PersonalWorkspaceArchiveNotice;
  }): OrganizationMemberAdmissionService {
    return new OrganizationMemberAdmissionService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      repository: OrganizationMembershipRepository;
      admissions: OrganizationAdmissions;
      workspaceNotices: PersonalWorkspaceArchiveNotice;
    },
  ) {}

  private get repo(): OrganizationMembershipRepository {
    return this.dependencies.repository;
  }

  /**
   * Removes a user from an organization and all its teams.
   */
  async deleteMember(params: {
    organizationId: string;
    userId: string;
    actingUserId?: string | null;
  }): Promise<void> {
    if (params.actingUserId != null && params.actingUserId === params.userId) {
      throw new CannotRemoveSelfError();
    }

    await this.repo.getMembership({
      organizationId: params.organizationId,
      userId: params.userId,
    });

    const teamIds = await this.repo.deleteMember({
      organizationId: params.organizationId,
      userId: params.userId,
      actingUserId: params.actingUserId ?? null,
    });
    if (teamIds.length === 0) return;
    await this.dependencies.workspaceNotices.personalWorkspaceArchived({
      organizationId: params.organizationId,
      userId: params.userId,
      teamIds,
    });
  }

  /** Admits somebody on the joiner seat (ADR-171). A MEMBER row carries the
   *  grant intent an unfinished admission resumes from, in the ledger's own
   *  scheme (ADR-129); a DEVELOPER row is the whole admission, no grant. */
  async createMembership({
    organizationId,
    userId,
    admittedBy,
    seat,
    origin,
  }: {
    organizationId: string;
    userId: string;
    admittedBy?: Readonly<{ actor: LedgerActor; commandId: string }>;
    seat?: "MEMBER" | "DEVELOPER";
    origin?: "web" | "cli";
  }): Promise<{ outcome: "created" | "already-present"; seat: "MEMBER" | "DEVELOPER" }> {
    const grantId = newAuthzGrantId();
    const admission = await this.repo.createMembership({
      organizationId,
      userId,
      pendingAdmissionId: grantId,
      via: admissionVia(admittedBy),
      ...(seat === undefined ? {} : { seat }),
      ...(origin === undefined ? {} : { origin }),
    });
    if (admission.outcome !== "created" || !admittedBy || admission.seat === "DEVELOPER") {
      return admission;
    }

    // A join lands its grant here, audited to whoever admitted it: `join-request`
    // is deliberately auditable, so an automatic join reads like a clicked one.
    await this.dependencies.admissions.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: grantId,
          principal: { userId },
          role: "MEMBER",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      ],
      caller: { type: "system" },
      actor: admittedBy.actor,
      source: "join-request",
      onDuplicate: "skip",
      commandId: admittedBy.commandId,
      requireProjection: true,
    });
    await this.dependencies.admissions.completeAdmission({ organizationId, userId, grantId });
    return admission;
  }

  /** Refuses when taking this member out would leave the organization with no
   *  administrator who can sign in — the one lockout nothing inside the product
   *  can undo. Asked by callers whose own path writes the membership row. */
  async assertRemovalKeepsAnAdministrator(params: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const membership = await this.repo.getMembership(params).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "member_not_found") return undefined;
      throw error;
    });
    // Not a member, or not an administrator who can sign in: there is no
    // administrator to lose, so there is nothing to refuse.
    if (!membership) return;
    if (membership.role !== OrganizationUserRole.ADMIN || membership.disabledAt !== null) return;

    const administrators = await this.repo.findActiveAdministratorIds({
      organizationId: params.organizationId,
    });
    if (administrators.some((administrator) => administrator !== params.userId)) return;

    throw new CannotRemoveLastAdminError();
  }
}

/** The route an admission arrived by, as its audit row names it. */
function admissionVia(
  admittedBy: Readonly<{ actor: LedgerActor; commandId: string }> | undefined,
): DeveloperAdmissionVia {
  if (!admittedBy) return "sso";
  return admittedBy.actor.type === "user" ? "join-request-approved" : "domain-join";
}

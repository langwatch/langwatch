import type { AuthzGrantCaller } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { SignInIdpKind } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import {
  type HeldMembership,
  type HeldMemberships,
  MemberSeatLimitReachedError,
  type OpenSeatRequests,
  type OrganizationAdmission,
  OrganizationUserRole,
  type RefusedSignInOutcome,
  type SeatApprovalPath,
  type SeatRequestResolved,
  type SeatRequestSource,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type {
  SeatRequestRepository,
  SeatRequestRow,
} from "../repositories/seat-request.repository.ts";
import { type SeatApprovalPlan, seatApprovalPath } from "../rules/seat-approval-path.rules.ts";
import type {
  AccessNoticeApproval,
  AccessNoticeRecipient,
  OrganizationAccessNoticeService,
} from "./organization-access-notice.service.ts";
import type {
  OrganizationSeatLicense,
  OrganizationPlanUser,
} from "./organization-seat-license.service.ts";

/** One person to contact about a held seat, in the order they are named. */
type SeatContact = Readonly<{ userId: string; name: string | null; email: string | null }>;

/** The membership operations an approval performs, all organization's own. */
export interface SeatRequestMemberships {
  changeMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    currentUserId: string | null;
    caller: AuthzGrantCaller;
  }): Promise<unknown>;
  setMemberDisabled(input: {
    organizationId: string;
    userId: string;
    disabled: boolean;
    actingUser: OrganizationPlanUser | null;
  }): Promise<void>;
  findAdministrators(input: {
    organizationId: string;
  }): Promise<{ userId: string; name: string | null; email: string | null }[]>;
}

/** The peers and reads a seat request is decided over. */
export interface SeatRequestPeers {
  activePlan(input: { organizationId: string }): Promise<SeatApprovalPlan>;
  pricing(input: {
    organizationId: string;
  }): Promise<{ pricingModel: "TIERED" | "SEAT_EVENT" | null; currency: "USD" | "EUR" }>;
  organizationName(input: { organizationId: string }): Promise<string>;
  /** Authz's Billing role holders on enabled memberships. */
  billingMembers(input: { organizationId: string }): Promise<readonly { userId: string }[]>;
  /** Invites an address as a full member, for a request with no membership to promote. */
  inviteMember(input: {
    organizationId: string;
    email: string;
    invitedBy: OrganizationPlanUser;
  }): Promise<void>;
  /** Billing's sales notice for an account-managed organization; never throws. */
  notifySales(input: {
    organizationId: string;
    organizationName: string;
    plan: string;
    seats: number;
    requestedSeats: number;
  }): Promise<void>;
}

type Dependencies = Readonly<{
  requests: SeatRequestRepository;
  members: OrganizationMembershipRepository;
  memberships: SeatRequestMemberships;
  seats: Pick<OrganizationSeatLicense, "checkLimit">;
  notices: OrganizationAccessNoticeService;
  peers: SeatRequestPeers;
  isSaas: boolean;
  now: () => number;
  newId: () => string;
  logger: Logger;
}>;

/**
 * Seat requests (modules/organization/specs/seat-requests.feature): opened when an arrival
 * wanted a full seat and did not get one, approved the way the organization pays, and read
 * back by the person they hold waiting.
 */
export class SeatRequestService {
  static create(dependencies: Dependencies): SeatRequestService {
    return new SeatRequestService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /**
   * Opens a request when an admission asked for a full seat and was left Lite or held (ruling
   * R1). A Developer seat, a retried admission and a seat that fitted open nothing.
   */
  async openForAdmission(input: {
    organizationId: string;
    userId: string;
    requestedSeat: "MEMBER" | "DEVELOPER" | undefined;
    admission: OrganizationAdmission;
  }): Promise<void> {
    const { organizationId, userId, admission } = input;
    if (admission.outcome !== "created" || admission.seat !== "EXTERNAL") return;
    const requested =
      input.requestedSeat ?? (await this.dependencies.members.readJoinerSeat({ organizationId }));
    if (requested !== "MEMBER") return;
    const person = await this.memberOf({ organizationId, userId });
    if (!person?.email) return;
    await this.open({
      organizationId,
      email: person.email,
      userId,
      name: person.name,
      source: admission.pending ? "pending" : "lite",
      idpRefused: false,
      idpKind: null,
    });
  }

  /** After an identity provider refused a sign-in tied to an address (ruling R3). */
  async recordRefusedSignIn({
    organizationId,
    email,
    idp,
  }: {
    organizationId: string;
    email: string;
    idp: SignInIdpKind | null;
  }): Promise<RefusedSignInOutcome> {
    const address = email.trim().toLowerCase();
    const [full, lite] = await Promise.all([
      this.dependencies.seats.checkLimit({ organizationId, resource: "members" }),
      this.dependencies.seats.checkLimit({ organizationId, resource: "membersLite" }),
    ]);
    if (!full.allowed && !lite.allowed) {
      await this.open({
        organizationId,
        email: address,
        userId: null,
        name: null,
        source: "idp_refused",
        idpRefused: true,
        idpKind: idp,
      });
      return { outcome: "seat_limit" };
    }
    await this.dependencies.notices.record({
      organizationId,
      kind: "idp_refused",
      email: address,
      name: null,
      idp,
      idpRefused: true,
    });
    return { outcome: "refused" };
  }

  async isSeatRequested({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const rows = await this.dependencies.requests.findForUser({ userId });
    return rows.some((row) => row.organizationId === organizationId && row.status === "OPEN");
  }

  async listOpen({ organizationId }: { organizationId: string }): Promise<OpenSeatRequests> {
    const [rows, approval] = await Promise.all([
      this.dependencies.requests.findOpen({ organizationId }),
      this.approvalOf({ organizationId }),
    ]);
    return {
      requests: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        userId: row.userId,
        source: row.source,
        idpRefused: row.idpRefused,
        idpKind: row.idpKind,
        openedAt: row.openedAt,
      })),
      seatFree: approval.seatFree,
      approvalPath: approval.path,
    };
  }

  /** Gives the full seat; refuses member_seat_limit_reached while no full seat is free. */
  async approve({
    organizationId,
    seatRequestId,
    by,
  }: {
    organizationId: string;
    seatRequestId: string;
    by: OrganizationPlanUser;
  }): Promise<SeatRequestResolved> {
    const request = await this.dependencies.requests.getOpen({ organizationId, id: seatRequestId });
    const membership = request.userId
      ? await this.dependencies.members
          .getMembership({ organizationId, userId: request.userId })
          .catch((error: unknown) => {
            if (HandledError.isHandled(error) && error.code === "member_not_found") return null;
            throw error;
          })
      : null;
    const isFull =
      membership !== null &&
      (membership.role === OrganizationUserRole.MEMBER ||
        membership.role === OrganizationUserRole.ADMIN);
    if (!(isFull && membership.disabledAt === null)) {
      await this.assertFullSeatFree({ organizationId, by });
    }

    const outcome = await this.giveFullSeat({ organizationId, request, membership, isFull, by });
    await this.dependencies.requests.resolve({
      organizationId,
      id: request.id,
      status: "APPROVED",
      resolvedByUserId: by.id,
      at: this.dependencies.now(),
    });
    return { outcome };
  }

  async decline({
    organizationId,
    seatRequestId,
    by,
  }: {
    organizationId: string;
    seatRequestId: string;
    by: OrganizationPlanUser;
  }): Promise<SeatRequestResolved> {
    const request = await this.dependencies.requests.getOpen({ organizationId, id: seatRequestId });
    await this.dependencies.requests.resolve({
      organizationId,
      id: request.id,
      status: "DECLINED",
      resolvedByUserId: by.id,
      at: this.dependencies.now(),
    });
    return { outcome: "declined" };
  }

  /** The caller's memberships they cannot use, each with whom to contact (ruling R2). */
  async heldMemberships({ userId }: { userId: string }): Promise<HeldMemberships> {
    const [states, requests] = await Promise.all([
      this.dependencies.members.findMembershipStates({ userId }),
      this.dependencies.requests.findForUser({ userId }),
    ]);
    const held: HeldMembership[] = [];
    for (const state of states.filter((candidate) => candidate.disabled)) {
      const request = requests.find((row) => row.organizationId === state.organizationId);
      const contacts = await this.contacts({ organizationId: state.organizationId });
      held.push({
        organizationId: state.organizationId,
        organizationName: state.organizationName,
        reason: heldReason({ role: state.role, request }),
        contacts: contacts.flatMap((contact) => {
          const name = contact.name ?? contact.email;
          return name ? [{ name, email: contact.email }] : [];
        }),
      });
    }
    return { hasActiveMembership: states.some((state) => !state.disabled), held };
  }

  /** Active administrators first, then Billing members, each once, with an address. */
  async recipients({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AccessNoticeRecipient[]> {
    const contacts = await this.contacts({ organizationId });
    return contacts.flatMap((contact) =>
      contact.email ? [{ userId: contact.userId, email: contact.email }] : [],
    );
  }

  /** The mail's wording of the approval, from the same path the requests list shows. */
  async noticeApproval({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AccessNoticeApproval> {
    const { seatFree, path } = await this.approvalOf({ organizationId });
    if (seatFree) return { kind: "seat_free" };
    return path.kind === "stripe_seats"
      ? { kind: "stripe_seats", seatPrice: path.seatPrice }
      : { kind: path.kind };
  }

  private async open(input: {
    organizationId: string;
    email: string;
    userId: string | null;
    name: string | null;
    source: SeatRequestSource;
    idpRefused: boolean;
    idpKind: SignInIdpKind | null;
  }): Promise<void> {
    const { requests, notices, now, newId } = this.dependencies;
    const opened = await requests.open({ ...input, id: newId(), at: now() });
    if (opened.outcome === "already_open") return;
    await notices.record({
      organizationId: input.organizationId,
      kind: "seat_request",
      email: input.email,
      name: input.name,
      idp: input.idpKind,
      idpRefused: input.idpRefused,
      heldWithoutAccess: input.source !== "lite",
    });
    await this.tellSales({ request: opened.request });
  }

  /** Sales hear once per opening, and only where only sales can sell the seat. */
  private async tellSales({ request }: { request: SeatRequestRow }): Promise<void> {
    const { organizationId } = request;
    const [plan, { path }] = await Promise.all([
      this.dependencies.peers.activePlan({ organizationId }),
      this.approvalOf({ organizationId }),
    ]);
    if (path.kind !== "contact_sales" || !this.dependencies.isSaas) return;
    const claimed = await this.dependencies.requests.claimSalesNotice({
      id: request.id,
      at: this.dependencies.now(),
    });
    if (!claimed) return;
    await this.dependencies.peers.notifySales({
      organizationId,
      organizationName: await this.dependencies.peers.organizationName({ organizationId }),
      plan: plan.type,
      seats: plan.maxMembers,
      requestedSeats: plan.maxMembers + 1,
    });
  }

  private async approvalOf({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ seatFree: boolean; path: SeatApprovalPath }> {
    const { peers, seats, isSaas } = this.dependencies;
    const [plan, pricing, organizationName, full] = await Promise.all([
      peers.activePlan({ organizationId }),
      peers.pricing({ organizationId }),
      peers.organizationName({ organizationId }),
      seats.checkLimit({ organizationId, resource: "members" }),
    ]);
    return {
      seatFree: full.allowed,
      path: seatApprovalPath({
        isSaas,
        plan,
        pricingModel: pricing.pricingModel,
        currency: pricing.currency,
        organizationName,
      }),
    };
  }

  private async assertFullSeatFree({
    organizationId,
    by,
  }: {
    organizationId: string;
    by: OrganizationPlanUser;
  }): Promise<void> {
    const result = await this.dependencies.seats.checkLimit({
      organizationId,
      resource: "members",
      user: by,
    });
    if (!result.allowed) {
      throw new MemberSeatLimitReachedError({
        meta: { limitType: result.limitType, current: result.current, max: result.max },
      });
    }
  }

  /** Lite becomes full, a held row becomes full and is enabled, an address alone is invited. */
  private async giveFullSeat({
    organizationId,
    request,
    membership,
    isFull,
    by,
  }: {
    organizationId: string;
    request: SeatRequestRow;
    membership: { role: OrganizationUserRole; disabledAt: unknown } | null;
    isFull: boolean;
    by: OrganizationPlanUser;
  }): Promise<SeatRequestResolved["outcome"]> {
    const { memberships, peers } = this.dependencies;
    if (!membership || !request.userId) {
      await peers.inviteMember({ organizationId, email: request.email, invitedBy: by });
      return "invited";
    }
    const userId = request.userId;
    const held = membership.disabledAt !== null;
    // A grant lands only on a live membership, so a held row is enabled before its role moves.
    if (held) {
      await memberships.setMemberDisabled({
        organizationId,
        userId,
        disabled: false,
        actingUser: by,
      });
    }
    if (!isFull) {
      try {
        // The approver's seat decision stands for the organization: the grant is the system's.
        await memberships.changeMemberRole({
          organizationId,
          userId,
          role: OrganizationUserRole.MEMBER,
          currentUserId: by.id,
          caller: { type: "system" },
        });
      } catch (error) {
        if (held) {
          await memberships.setMemberDisabled({
            organizationId,
            userId,
            disabled: true,
            actingUser: null,
          });
        }
        throw error;
      }
    }
    if (held) return "enabled";
    return isFull ? "already_member" : "promoted";
  }

  private async memberOf({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<{ name: string | null; email: string | null } | undefined> {
    const rows = await this.dependencies.members.findMembersWithDepartments({ organizationId });
    const row = rows.find((candidate) => candidate.userId === userId);
    return row ? { name: row.user.name, email: row.user.email?.toLowerCase() ?? null } : undefined;
  }

  private async contacts({ organizationId }: { organizationId: string }): Promise<SeatContact[]> {
    const { memberships, peers, members, logger } = this.dependencies;
    const [administrators, billing, rows] = await Promise.all([
      memberships.findAdministrators({ organizationId }),
      peers.billingMembers({ organizationId }).catch((error: unknown) => {
        logger.warn({ organizationId, error }, "could not read the organization's Billing members");
        return [];
      }),
      members.findMembersWithDepartments({ organizationId }),
    ]);
    const seen = new Set<string>();
    const ordered: SeatContact[] = [];
    for (const administrator of administrators) {
      if (seen.has(administrator.userId)) continue;
      seen.add(administrator.userId);
      ordered.push(administrator);
    }
    for (const { userId } of billing) {
      const row = rows.find(
        (candidate) => candidate.userId === userId && candidate.disabledAt === null,
      );
      if (!row || seen.has(userId)) continue;
      seen.add(userId);
      ordered.push({ userId, name: row.user.name, email: row.user.email });
    }
    return ordered;
  }
}

/** Over the seat limit while a request waits or the row is held Lite; otherwise turned off. */
function heldReason({
  role,
  request,
}: {
  role: OrganizationUserRole;
  request: SeatRequestRow | undefined;
}): HeldMembership["reason"] {
  if (request?.status === "OPEN") return "seat_limit";
  if (request?.status === "DECLINED") return "access_turned_off";
  return role === OrganizationUserRole.EXTERNAL ? "seat_limit" : "access_turned_off";
}

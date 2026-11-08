import type { AuthzGrantCaller } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { SignInIdpKind } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import {
  type HeldMembership,
  type HeldMemberships,
  type OpenSeatRequests,
  type OrganizationAdmission,
  OrganizationUserRole,
  type RefusedSignInOutcome,
  type SeatApprovalPath,
  SeatRequestNotFoundError,
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
import { SeatRequestApprovalService } from "./seat-request-approval.service.ts";

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
  /** Whether the address holds an unexpired invitation to the organization. */
  hasOpenInvite(input: { organizationId: string; email: string }): Promise<boolean>;
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

/** Refused sign-ins an organization is told about per UTC day, both kinds together. */
export const REFUSED_SIGN_IN_DAILY_CAP = 20;

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

  private constructor(private readonly dependencies: Dependencies) {
    this.approval = SeatRequestApprovalService.create(dependencies);
  }

  private readonly approval: SeatRequestApprovalService;

  /**
   * Opens a request when an admission asked for a full seat and was left Lite or held (ruling
   * R1). A repeated admission of a held member only fills a missing request, so one whose
   * first opening failed is still seen, and an answered one is never reopened.
   */
  async openForAdmission(input: {
    organizationId: string;
    userId: string;
    requestedSeat: "MEMBER" | "DEVELOPER" | undefined;
    admission: OrganizationAdmission;
  }): Promise<void> {
    const { organizationId, userId, admission } = input;
    if (admission.seat !== "EXTERNAL") return;
    // A Lite member signing in again may have been moved there by an admin: only held fills in.
    if (admission.outcome === "already-present" && !admission.pending) return;
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
      onlyIfAbsent: admission.outcome === "already-present",
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
    const [joinerSeat, full, refusedToday] = await Promise.all([
      this.dependencies.members.readJoinerSeat({ organizationId }),
      this.dependencies.seats.checkLimit({ organizationId, resource: "members" }),
      this.dependencies.notices.refusedSignInsToday({ organizationId }),
    ]);
    // As at admission: a joiner whose role takes a full seat with none free is left Lite or held.
    const outcome = joinerSeat === "MEMBER" && !full.allowed ? "seat_limit" : "refused";
    // The address is only what was typed at sign-in start, so a burst of refusals answers the
    // screen but stops opening requests and mailing administrators for the rest of the day.
    if (refusedToday >= REFUSED_SIGN_IN_DAILY_CAP) {
      this.dependencies.logger.warn(
        { organizationId, refusedToday },
        "refused sign-in notices hit the daily cap; recording nothing more today",
      );
      return { outcome };
    }
    if (outcome === "seat_limit") {
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

  /** Approvals whose seat never landed are reopened first, so they are on the list again. */
  async listOpen({ organizationId }: { organizationId: string }): Promise<OpenSeatRequests> {
    await this.approval.reopenStranded({ organizationId }).catch((error: unknown) => {
      this.dependencies.logger.warn(
        { error, organizationId },
        "could not reopen stranded seat request approvals",
      );
    });
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
  approve(input: {
    organizationId: string;
    seatRequestId: string;
    by: OrganizationPlanUser;
  }): Promise<SeatRequestResolved> {
    return this.approval.approve(input);
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
    const declined = await this.dependencies.requests.resolve({
      organizationId,
      id: request.id,
      status: "DECLINED",
      resolvedByUserId: by.id,
      at: this.dependencies.now(),
    });
    if (!declined) throw new SeatRequestNotFoundError(request.id);
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
    onlyIfAbsent?: boolean;
  }): Promise<void> {
    const { requests, notices, now, newId } = this.dependencies;
    const opened = await requests.open({ ...input, id: newId(), at: now() });
    if (opened.outcome !== "opened" && opened.outcome !== "reopened") return;
    // The request is open either way, and a later arrival answers already_open, so sales are
    // told even when the notice could not be recorded.
    await notices
      .record({
        organizationId: input.organizationId,
        kind: "seat_request",
        email: input.email,
        name: input.name,
        idp: input.idpKind,
        idpRefused: input.idpRefused,
        heldWithoutAccess: input.source !== "lite",
      })
      .catch((error: unknown) => {
        this.dependencies.logger.warn(
          { organizationId: input.organizationId, error },
          "could not record the seat request notice",
        );
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

  private async memberOf({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<{ name: string | null; email: string | null } | undefined> {
    const row = await this.dependencies.members
      .getMembership({ organizationId, userId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "member_not_found") return undefined;
        throw error;
      });
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

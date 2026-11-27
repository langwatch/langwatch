import type { AuthzGrantCaller } from "@langwatch/authz-contract";
import {
  type SeatPayment,
  type SeatPaymentStatus,
  type SeatPurchase,
} from "@langwatch/enterprise-billing-contract";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import type { SignInIdpKind } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import {
  type HeldMemberships,
  type MyAccessRequest,
  type OpenSeatRequests,
  type OrganizationAdmission,
  OrganizationUserRole,
  type RefusedSignInOutcome,
  type SeatApprovalCompletion,
  type SeatApprovalWithSeat,
  SeatRequestFullMemberError,
  SeatRequestNoEmailError,
  SeatRequestNotFoundError,
  type SeatRequestReason,
  type SeatRequestResolved,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type { SeatApprovalPaymentRepository } from "../repositories/seat-approval-payment.repository.ts";
import type { SeatRequestRepository } from "../repositories/seat-request.repository.ts";
import type { SeatApprovalPlan } from "../rules/seat-approval-path.rules.ts";
import { seatRequestReasonWords } from "../rules/seat-request-reason.rules.ts";
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
import { SeatRequestContactService } from "./seat-request-contact.service.ts";
import { SeatRequestNoticeService } from "./seat-request-notice.service.ts";
import { SeatRequestStandingService } from "./seat-request-standing.service.ts";

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
  /** Billing buys one more full seat; a purchase may wait on a Stripe page to finish. */
  addFullSeat(input: {
    organizationId: string;
    customerEmail: string | null;
  }): Promise<SeatPurchase>;
  /** Whether a seat payment is paid, still open, or over; scoped to the organization's customer. */
  settleSeatPayment(input: {
    organizationId: string;
    payment: SeatPayment;
  }): Promise<{ status: SeatPaymentStatus }>;
  /** Billing's sales notice for an account-managed organization; `sent` false when it failed. */
  notifySales(input: {
    organizationId: string;
    organizationName: string;
    plan: string;
    seats: number;
    requestedSeats: number;
  }): Promise<{ sent: boolean }>;
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
  /** The payment each approval with a seat waits on; a completion settles only that one. */
  payments: SeatApprovalPaymentRepository;
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
    this.notice = SeatRequestNoticeService.create(dependencies);
    this.contacts = SeatRequestContactService.create(dependencies);
    this.standing = SeatRequestStandingService.create(dependencies);
  }

  private readonly approval: SeatRequestApprovalService;
  private readonly notice: SeatRequestNoticeService;
  private readonly contacts: SeatRequestContactService;
  private readonly standing: SeatRequestStandingService;

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
    await this.notice.open({
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
      await this.notice.open({
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
      this.notice.approvalOf({ organizationId }),
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
        reason: row.reason === null ? null : seatRequestReasonWords(row.reason),
        openedAt: row.openedAt,
      })),
      seatFree: approval.seatFree,
      approvalPath: approval.path,
    };
  }

  /** Gives the full seat; refuses member_seat_limit_reached while no full seat is free. */
  async approve(input: {
    organizationId: string;
    seatRequestId: string;
    by: OrganizationPlanUser;
    buySeat?: () => Promise<boolean>;
    openedAt?: number;
  }): Promise<SeatRequestResolved> {
    const request = await this.dependencies.requests.getOpen({
      organizationId: input.organizationId,
      id: input.seatRequestId,
    });
    // Pinned to the opening read here, so the answer names the request cycle it approved.
    if (input.openedAt !== undefined && input.openedAt !== request.openedAt) {
      throw new SeatRequestNotFoundError(request.id);
    }
    const resolved = await this.approval.approve({ ...input, openedAt: request.openedAt });
    await this.notice.tellRequester({ request, outcome: "approved" });
    return resolved;
  }

  /**
   * Approve that buys the one full seat it needs where the organization pays per seat in Stripe.
   * The purchase runs under the approval's claim, so one request buys at most one seat; a seat
   * bought for an approval that then fails stays free for the next one.
   */
  async approveWithSeat(input: {
    organizationId: string;
    seatRequestId: string;
    by: OrganizationPlanUser;
  }): Promise<SeatApprovalWithSeat> {
    const { organizationId } = input;
    const { openedAt } = await this.dependencies.requests.getOpen({
      organizationId,
      id: input.seatRequestId,
    });
    const bought: { purchase?: SeatPurchase } = {};
    const buySeat = async () => {
      const { path } = await this.notice.approvalOf({ organizationId });
      if (path.kind !== "stripe_seats") return false;
      bought.purchase = await this.dependencies.peers.addFullSeat({
        organizationId,
        customerEmail: input.by.email ?? null,
      });
      return bought.purchase.status === "added";
    };
    try {
      // The opening the payment reference names, so a replaced one is never approved for it.
      const { outcome } = await this.approve({ ...input, buySeat, openedAt });
      return { status: "approved", outcome, seatAdded: bought.purchase !== undefined };
    } catch (error) {
      const { purchase } = bought;
      const refused = HandledError.isHandled(error) && error.code === "member_seat_limit_reached";
      if (refused && purchase?.status === "payment_required") {
        const opening = { organizationId, seatRequestId: input.seatRequestId, openedAt };
        await this.dependencies.payments.save({ ...opening, payment: purchase.payment });
        return {
          status: "payment_required",
          url: purchase.url,
          paymentRef: JSON.stringify({ openedAt }),
        };
      }
      throw error;
    }
  }

  /** After the Stripe page: approves once the seat is paid; waiting while the page is open. */
  async completeSeatApproval(input: {
    organizationId: string;
    seatRequestId: string;
    paymentRef: string;
    by: OrganizationPlanUser;
  }): Promise<SeatApprovalCompletion> {
    const { organizationId, seatRequestId, by } = input;
    const { openedAt } = parsePaymentRef(input.paymentRef);
    const request = await this.dependencies.requests.getOpen({ organizationId, id: seatRequestId });
    // A payment opened before a decline and a new ask never approves the new opening.
    if (request.openedAt !== openedAt) throw new SeatRequestNotFoundError(seatRequestId);
    // Only the payment this opening's approval kept is settled, whatever the reference names.
    const [payment] = await this.dependencies.payments.find({
      organizationId,
      seatRequestId,
      openedAt,
    });
    if (!payment) throw new ValidationError(UNKNOWN_PAYMENT_REF);
    const { status } = await this.dependencies.peers.settleSeatPayment({ organizationId, payment });
    if (status === "open") return { status: "waiting" };
    if (status === "failed") return { status: "failed" };
    // The claim names the opening too, so one declined and reopened meanwhile stays open.
    const { outcome } = await this.approve({ organizationId, seatRequestId, by, openedAt });
    return { status: "approved", outcome };
  }

  /**
   * A member refused for want of a full seat asks for one. An open request answers as it is;
   * an answered one opens again, and the admins' mail is still sent once a day at most.
   */
  async requestAccess({
    organizationId,
    userId,
    reason,
  }: {
    organizationId: string;
    userId: string;
    reason?: SeatRequestReason;
  }): Promise<MyAccessRequest> {
    const membership = await this.dependencies.members.getMembership({ organizationId, userId });
    const isFull =
      membership.role === OrganizationUserRole.MEMBER ||
      membership.role === OrganizationUserRole.ADMIN;
    if (isFull && !membership.disabledAt) throw new SeatRequestFullMemberError();
    const email = membership.user.email?.toLowerCase();
    if (!email) throw new SeatRequestNoEmailError();
    await this.notice.open({
      organizationId,
      email,
      userId,
      name: membership.user.name,
      source: "requested",
      idpRefused: false,
      idpKind: null,
      reason: reason ?? null,
    });
    return this.myAccessRequest({ organizationId, userId });
  }

  /** The caller's own latest seat request in the organization. */
  async myAccessRequest(input: {
    organizationId: string;
    userId: string;
  }): Promise<MyAccessRequest> {
    return this.standing.myAccessRequest(input);
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
    await this.notice.tellRequester({ request, outcome: "declined" });
    return { outcome: "declined" };
  }

  /** The caller's memberships they cannot use, each with whom to contact (ruling R2). */
  async heldMemberships({ userId }: { userId: string }): Promise<HeldMemberships> {
    return this.contacts.heldMemberships({ userId });
  }

  /** Active administrators first, then Billing members, each once, with an address. */
  async recipients({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AccessNoticeRecipient[]> {
    return this.contacts.recipients({ organizationId });
  }

  /** The mail's wording of the approval, from the same path the requests list shows. */
  async noticeApproval({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AccessNoticeApproval> {
    return this.notice.noticeApproval({ organizationId });
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
}

const UNKNOWN_PAYMENT_REF = "The seat payment reference is not one this approval handed out";

/** The opening the reference `approveWithSeat` handed out names; anything else is refused. */
function parsePaymentRef(paymentRef: string): { openedAt: number } {
  let candidate: { openedAt?: unknown } | null;
  try {
    candidate = JSON.parse(paymentRef);
  } catch {
    throw new ValidationError(UNKNOWN_PAYMENT_REF);
  }
  const openedAt = candidate?.openedAt;
  if (typeof openedAt !== "number") throw new ValidationError(UNKNOWN_PAYMENT_REF);
  return { openedAt };
}

import type { SignInIdpKind } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import type { SeatApprovalPath, SeatRequestSource } from "@langwatch/organization-contract";

import type {
  SeatRequestRepository,
  SeatRequestRow,
} from "../repositories/seat-request.repository.ts";
import { seatApprovalPath } from "../rules/seat-approval-path.rules.ts";
import { seatRequestReasonWords } from "../rules/seat-request-reason.rules.ts";
import type {
  AccessNoticeApproval,
  OrganizationAccessNoticeService,
} from "./organization-access-notice.service.ts";
import type { OrganizationSeatLicense } from "./organization-seat-license.service.ts";
import type { SeatRequestPeers } from "./seat-request.service.ts";

type Dependencies = Readonly<{
  requests: SeatRequestRepository;
  seats: Pick<OrganizationSeatLicense, "checkLimit">;
  notices: OrganizationAccessNoticeService;
  peers: SeatRequestPeers;
  isSaas: boolean;
  now: () => number;
  newId: () => string;
  logger: Pick<Logger, "warn">;
}>;

/**
 * Opening a seat request and telling who it concerns: the administrators' notice, sales where
 * only sales sell the seat, and the requester once it is answered.
 */
export class SeatRequestNoticeService {
  static create(dependencies: Dependencies): SeatRequestNoticeService {
    return new SeatRequestNoticeService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  async open(input: {
    organizationId: string;
    email: string;
    userId: string | null;
    name: string | null;
    source: SeatRequestSource;
    idpRefused: boolean;
    idpKind: SignInIdpKind | null;
    reason?: string | null;
    onlyIfAbsent?: boolean;
  }): Promise<void> {
    const { requests, notices, now, newId } = this.dependencies;
    const opened = await requests.open({ ...input, id: newId(), at: now() });
    // A member's own ask on an arrival's open request is still noticed, under the daily limit.
    const asked = opened.outcome === "already_open" && input.source === "requested";
    if (opened.outcome !== "opened" && opened.outcome !== "reopened" && !asked) return;
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
        heldWithoutAccess: input.source !== "lite" && input.source !== "requested",
        ...(input.source === "requested"
          ? {
              askedFor: { reason: input.reason ? seatRequestReasonWords(input.reason) : null },
              seatRequestId: opened.request.id,
            }
          : {}),
      })
      .catch((error: unknown) => {
        this.dependencies.logger.warn(
          { organizationId: input.organizationId, error },
          "could not record the seat request notice",
        );
      });
    // The request is saved; a failed sales notice is logged and released for the next ask.
    await this.tellSales({ request: opened.request }).catch((error: unknown) => {
      this.dependencies.logger.warn(
        { organizationId: input.organizationId, error },
        "could not tell sales about the seat request",
      );
    });
  }

  /**
   * The person who asked hears the answer, when LangWatch knows their account; never throws.
   * A member who pressed Request access is also told in-app.
   */
  async tellRequester({
    request,
    outcome,
  }: {
    request: SeatRequestRow;
    outcome: "approved" | "declined";
  }): Promise<void> {
    if (!request.userId) return;
    await this.dependencies.notices
      .mailAnswer({
        organizationId: request.organizationId,
        seatRequestId: request.id,
        openedAt: request.openedAt,
        email: request.email,
        outcome,
      })
      .catch((error: unknown) => {
        this.dependencies.logger.warn(
          { organizationId: request.organizationId, error },
          "could not mail the seat request answer",
        );
      });
    if (request.source !== "requested") return;
    await this.dependencies.notices.pushAnswer({
      organizationId: request.organizationId,
      seatRequestId: request.id,
      openedAt: request.openedAt,
      userId: request.userId,
      outcome,
    });
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

  /** Sales hear once per opening, and only where only sales can sell the seat. */
  private async tellSales({ request }: { request: SeatRequestRow }): Promise<void> {
    const { organizationId } = request;
    const [plan, { path }] = await Promise.all([
      this.dependencies.peers.activePlan({ organizationId }),
      this.approvalOf({ organizationId }),
    ]);
    if (path.kind !== "contact_sales" || !this.dependencies.isSaas) return;
    // Read before the claim, so a failed read leaves the notice to the next opening or ask.
    const organizationName = await this.dependencies.peers.organizationName({ organizationId });
    const claim = { id: request.id, at: this.dependencies.now() };
    if (!(await this.dependencies.requests.claimSalesNotice(claim))) return;
    let sent = false;
    try {
      ({ sent } = await this.dependencies.peers.notifySales({
        organizationId,
        organizationName,
        plan: plan.type,
        seats: plan.maxMembers,
        requestedSeats: plan.maxMembers + 1,
      }));
    } finally {
      // A notice that did not go out frees its claim, so the next ask sends it.
      if (!sent) await this.dependencies.requests.releaseSalesNotice(claim);
    }
  }

  /** Whether a full seat is free, and how the organization pays for one. */
  async approvalOf({
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
}

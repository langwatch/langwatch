import { HandledError } from "@langwatch/handled-error";
import { type MyAccessRequest, OrganizationUserRole } from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type {
  SeatRequestRepository,
  SeatRequestRow,
} from "../repositories/seat-request.repository.ts";

type Dependencies = Readonly<{
  requests: Pick<SeatRequestRepository, "findForUser">;
  members: Pick<OrganizationMembershipRepository, "getMembership">;
}>;

/** How a stored request reads to the person who asked. */
const ACCESS_STATUS: Record<SeatRequestRow["status"], MyAccessRequest["status"]> = {
  OPEN: "open",
  APPROVED: "approved",
  DECLINED: "declined",
};

const NONE: MyAccessRequest = { status: "none", openedAt: null, resolvedAt: null };

/** Where a member's own seat request stands, as Request access reads it (seat-requests.feature). */
export class SeatRequestStandingService {
  static create(dependencies: Dependencies): SeatRequestStandingService {
    return new SeatRequestStandingService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /**
   * The caller's own latest seat request in the organization. An approval reads approved only
   * while they still hold a full seat: moved back to Lite since, they may ask again.
   */
  async myAccessRequest({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<MyAccessRequest> {
    const rows = await this.dependencies.requests.findForUser({ userId });
    const row = rows.find((candidate) => candidate.organizationId === organizationId);
    if (!row) return NONE;
    if (row.status === "APPROVED" && !(await this.holdsFullSeat({ organizationId, userId }))) {
      return NONE;
    }
    return {
      status: ACCESS_STATUS[row.status],
      openedAt: row.openedAt,
      resolvedAt: row.resolvedAt,
    };
  }

  private async holdsFullSeat({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const row = await this.dependencies.members
      .getMembership({ organizationId, userId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "member_not_found") return undefined;
        throw error;
      });
    if (!row || row.disabledAt) return false;
    return row.role === OrganizationUserRole.MEMBER || row.role === OrganizationUserRole.ADMIN;
  }
}

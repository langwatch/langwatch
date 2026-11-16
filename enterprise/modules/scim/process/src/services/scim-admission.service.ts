// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import {
  admissionSeat,
  seatsFree,
  type OrganizationAdmission,
} from "@langwatch/organization-contract";
import type { UserProfile } from "@langwatch/user-contract";

import type { ScimMembers } from "../channels/scim-channels.registry.ts";
import type { ScimRepository } from "../repositories/scim.repository.ts";
import { isUniqueViolation } from "../rules/scim-user.rules.ts";
import type { ScimHeldConnections } from "./scim-directory-identity.service.ts";
import type { ScimGrantsService } from "./scim-grants.service.ts";
import type { ScimMembershipAccessService } from "./scim-membership-access.service.ts";
import type { ScimSeats } from "./scim-seat-lease.service.ts";

type ScimAdmissionDependencies = {
  prisma: ScimRepository;
  grants: ScimGrantsService;
  provenOffboarding: boolean;
  seats: ScimSeats;
  plans: Pick<EntitlementApi, "getActivePlan">;
  connections: ScimHeldConnections;
  membershipAccess: ScimMembershipAccessService;
  /** Organization takes a held seat back, and opens the seat request of one left waiting. */
  members: Pick<ScimMembers, "takeBackHeldSeat" | "openSeatRequestForAdmission">;
};

const logger = createLogger("langwatch:scim:admission");

/** Who a directory push may bring into an organization, and the seat and role they enter on. */
export class ScimAdmissionService {
  private constructor(private readonly options: ScimAdmissionDependencies) {}

  static create(options: ScimAdmissionDependencies): ScimAdmissionService {
    return new ScimAdmissionService(options);
  }

  /** Whether the account's address is on a domain one of the organization's connections proved. */
  async isOnProvenDomain({
    organizationId,
    user,
  }: {
    organizationId: string;
    user: UserProfile;
  }): Promise<boolean> {
    const email = (user.email ?? "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at < 0) return false;
    const domain = email.slice(at + 1);
    const connections = await this.options.connections.findHeldConnections({ organizationId });

    return connections.some((connection) =>
      connection.verifiedDomains.some((proven) => proven.toLowerCase() === domain),
    );
  }

  /**
   * A retried create still repairs the grant beside an existing membership; its losing write
   * rolls back, so only the first create records the member-created fact.
   */
  async admit({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const asserted = await this.directoryAssertedOrganizationRole({ userId, organizationId });
    const plan = await this.options.plans.getActivePlan({ organizationId, user: { id: userId } });
    const { takesHeldSeat, admission } = await this.options.seats.withSeatLock({
      organizationId,
      work: async (lease) => {
        const [seats, holds] = await Promise.all([
          this.options.seats.countMemberSeats({ organizationId }),
          this.options.seats.findLiveHoldUserIds({ organizationId, userId }),
        ]);
        // A person back within their seat hold takes that seat, already counted, not another
        // (seat-rotation.feature).
        const isHeld = holds.length > 0;
        const counted = isHeld ? { ...seats, fullMembers: seats.fullMembers - 1 } : seats;
        const { role, pending } = admissionSeat({
          requested: asserted,
          ...seatsFree({ plan, seats: counted }),
        });
        let outcome: OrganizationAdmission["outcome"] = "created";
        await lease.assertHeld();
        try {
          await this.options.prisma.addMembership({ userId, organizationId, role, pending });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          outcome = "already-present";
        }
        const seat: OrganizationAdmission["seat"] = role === "EXTERNAL" ? "EXTERNAL" : "MEMBER";
        return { takesHeldSeat: isHeld && !pending, admission: { outcome, seat, pending } };
      },
    });

    await this.options.membershipAccess.reconcileOrganizationMembership({ userId, organizationId });
    if (takesHeldSeat) {
      await this.options.members.takeBackHeldSeat({ organizationId, userId });
    }
    // The admission stands whether or not its seat request could be opened.
    await this.options.members
      .openSeatRequestForAdmission({ organizationId, userId, admission })
      .catch((error: unknown) => {
        logger.error({ error, organizationId, userId }, "opening the seat request failed");
      });
  }

  /**
   * The membership row's role, from what the directory asserts: ADMIN when a SCIM group mapped
   * ADMIN at organization scope holds them under SCIM_V2_GRANTS, else MEMBER. A provisioned
   * person is a member whatever else was or was not mapped; without the flag, always MEMBER.
   */
  private async directoryAssertedOrganizationRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<"ADMIN" | "MEMBER"> {
    if (!this.options.provenOffboarding) return "MEMBER";
    const groupIds = await this.options.prisma.findDirectoryGroupIds({ userId, organizationId });
    const roles = await this.options.grants.findDirectoryAssertedRoles({
      organizationId,
      userId,
      groupIds,
    });
    return roles.includes("ADMIN") ? "ADMIN" : "MEMBER";
  }
}

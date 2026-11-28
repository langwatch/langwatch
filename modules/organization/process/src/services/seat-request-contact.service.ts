import type { Logger } from "@langwatch/observability";
import {
  type HeldMembership,
  type HeldMemberships,
  OrganizationUserRole,
} from "@langwatch/organization-contract";

import type { OrganizationMembershipRepository } from "../repositories/organization-membership.repository.ts";
import type {
  SeatRequestRepository,
  SeatRequestRow,
} from "../repositories/seat-request.repository.ts";
import type { AccessNoticeRecipient } from "./organization-access-notice.service.ts";
import type { SeatRequestMemberships, SeatRequestPeers } from "./seat-request.service.ts";

/** One person to contact about a held seat, in the order they are named. */
type SeatContact = Readonly<{ userId: string; name: string | null; email: string | null }>;

type Dependencies = Readonly<{
  requests: Pick<SeatRequestRepository, "findForUser">;
  members: OrganizationMembershipRepository;
  memberships: Pick<SeatRequestMemberships, "findAdministrators">;
  peers: Pick<SeatRequestPeers, "billingMembers">;
  logger: Pick<Logger, "warn">;
}>;

/** Whom a person held out of an organization contacts, and who hears about a seat request. */
export class SeatRequestContactService {
  static create(dependencies: Dependencies): SeatRequestContactService {
    return new SeatRequestContactService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

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

  async contacts({ organizationId }: { organizationId: string }): Promise<SeatContact[]> {
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

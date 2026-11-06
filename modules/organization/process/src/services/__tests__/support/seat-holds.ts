import type { Instant } from "@langwatch/time";

import { MemoryOrganizationDatabase } from "../../../repositories/memory/memory.organization.database.ts";
import { MemorySeatHoldRepository } from "../../../repositories/memory/memory.seat-hold.repository.ts";
import type { OrganizationMembershipRepository } from "../../../repositories/organization-membership.repository.ts";
import type { SeatHoldRepository } from "../../../repositories/seat-hold.repository.ts";
import { SeatHoldService } from "../../seat-hold.service.ts";

/**
 * A membership repository with the seat holds over it, for a service under test: the holds live
 * in `memory` when given (the membership twin writes them there), else in `holds`, else nowhere.
 */
export function withSeatHolds<Repository extends OrganizationMembershipRepository>({
  repository,
  memory,
  holds,
  now,
}: {
  repository: Repository;
  memory?: MemoryOrganizationDatabase;
  holds?: SeatHoldRepository;
  now?: () => Instant;
}): { repository: Repository; seatHolds: SeatHoldService } {
  return {
    repository,
    seatHolds: SeatHoldService.create({
      memberships: repository,
      holds:
        holds ??
        MemorySeatHoldRepository.create({ memory: memory ?? MemoryOrganizationDatabase.create() }),
      ...(now ? { now } : {}),
    }),
  };
}

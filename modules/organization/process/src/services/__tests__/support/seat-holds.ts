import type { Instant } from "@langwatch/time";

import { MemoryOrganizationDatabase } from "../../../repositories/memory/memory.organization.database.ts";
import { MemorySeatHoldRepository } from "../../../repositories/memory/memory.seat-hold.repository.ts";
import { MemorySeatRequestRepository } from "../../../repositories/memory/memory.seat-request.repository.ts";
import type { OrganizationMembershipRepository } from "../../../repositories/organization-membership.repository.ts";
import type { SeatHoldRepository } from "../../../repositories/seat-hold.repository.ts";
import type { SeatRequestRepository } from "../../../repositories/seat-request.repository.ts";
import { SeatHoldService } from "../../seat-hold.service.ts";

/**
 * A membership repository with the seat holds over it, for a service under test: the holds live
 * in `memory` when given (the membership twin writes them there), else in `holds`, else nowhere.
 * Seat requests live in `seatRequests` when given, else in a fresh in-memory store.
 */
export function withSeatHolds<Repository extends OrganizationMembershipRepository>({
  repository,
  memory,
  holds,
  seatRequests,
  now,
}: {
  repository: Repository;
  memory?: MemoryOrganizationDatabase;
  holds?: SeatHoldRepository;
  seatRequests?: SeatRequestRepository;
  now?: () => Instant;
}): { repository: Repository; seatHolds: SeatHoldService; seatRequests: SeatRequestRepository } {
  return {
    repository,
    seatRequests: seatRequests ?? MemorySeatRequestRepository.create(),
    seatHolds: SeatHoldService.create({
      memberships: repository,
      holds:
        holds ??
        MemorySeatHoldRepository.create({ memory: memory ?? MemoryOrganizationDatabase.create() }),
      ...(now ? { now } : {}),
    }),
  };
}

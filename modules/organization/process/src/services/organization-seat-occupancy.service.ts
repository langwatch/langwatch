import type { OrganizationSeatOccupants } from "@langwatch/organization-contract";

import type { OrganizationDeparturesRepository } from "../repositories/organization-departures.repository.ts";
import type { OrganizationSeatRepository } from "../repositories/organization-seat.repository.ts";

/**
 * Who held a seat in a window: today's full-seat members and the people who left in it.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
export class OrganizationSeatOccupancyService {
  static create(deps: {
    seats: Pick<OrganizationSeatRepository, "findFullSeatHolderIds">;
    departures: OrganizationDeparturesRepository;
  }): OrganizationSeatOccupancyService {
    return new OrganizationSeatOccupancyService(deps.seats, deps.departures);
  }

  private constructor(
    private readonly seats: Pick<OrganizationSeatRepository, "findFullSeatHolderIds">,
    private readonly departures: OrganizationDeparturesRepository,
  ) {}

  async findSince({
    organizationId,
    since,
  }: {
    organizationId: string;
    since: number;
  }): Promise<OrganizationSeatOccupants> {
    const [fullSeatHolderIds, departedIds] = await Promise.all([
      this.seats.findFullSeatHolderIds(organizationId),
      this.departures.findDepartedSince({ organizationId, since }),
    ]);
    return { fullSeatHolderIds, departedIds };
  }
}

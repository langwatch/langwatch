import { OrganizationDeparturesRepository } from "../organization-departures.repository.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/** The departures the memory membership twin records as it removes and disables members. */
export class MemoryOrganizationDeparturesRepository extends OrganizationDeparturesRepository {
  static create(options: {
    memory: MemoryOrganizationDatabase;
  }): MemoryOrganizationDeparturesRepository {
    return new MemoryOrganizationDeparturesRepository(options.memory);
  }

  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  async findDepartedSince({
    organizationId,
    since,
  }: {
    organizationId: string;
    since: number;
  }): Promise<string[]> {
    const departed = this.memory.memberDepartures
      .filter(
        (departure) =>
          departure.organizationId === organizationId &&
          departure.heldFullSeat &&
          departure.occurredAt.epochMilliseconds >= since,
      )
      .map((departure) => departure.userId);
    return [...new Set(departed)];
  }
}

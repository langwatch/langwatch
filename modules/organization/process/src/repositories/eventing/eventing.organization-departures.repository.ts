import { createTenantId, type EventReadSeat } from "@langwatch/eventing";
import {
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import { z } from "zod";

import { OrganizationDeparturesRepository } from "../organization-departures.repository.ts";

/** The one read this repository takes: one organization's lifecycle stream. */
type OrganizationEventReads = Pick<EventReadSeat, "findAggregateEvents">;

const DEPARTURE_EVENT_TYPES: ReadonlySet<string> = new Set([
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
]);

/** The fields a departure carries; anything else in the stream is skipped. */
const departureSchema = z.object({
  type: z.string(),
  occurredAt: z.number(),
  data: z.object({ userId: z.string().min(1), heldFullSeat: z.boolean().nullish() }),
});

/** Departures read from the member facts the organization records on its own aggregate. */
export class EventingOrganizationDeparturesRepository extends OrganizationDeparturesRepository {
  static create(deps: {
    eventReadSeat: OrganizationEventReads;
  }): EventingOrganizationDeparturesRepository {
    return new EventingOrganizationDeparturesRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: OrganizationEventReads) {
    super();
  }

  async findDepartedSince({
    organizationId,
    since,
  }: {
    organizationId: string;
    since: number;
  }): Promise<string[]> {
    const events = await this.eventReadSeat.findAggregateEvents({
      tenantId: createTenantId(organizationId),
      aggregateType: ORGANIZATION_AGGREGATE_TYPE,
      aggregateId: organizationId,
    });
    const departed = new Set<string>();
    for (const event of events) {
      const parsed = departureSchema.safeParse(event);
      if (!parsed.success || !DEPARTURE_EVENT_TYPES.has(parsed.data.type)) continue;
      // A fact from before the seat type was recorded counts, as it may have held one.
      if (parsed.data.data.heldFullSeat === false) continue;
      if (parsed.data.occurredAt >= since) departed.add(parsed.data.data.userId);
    }
    return [...departed];
  }
}

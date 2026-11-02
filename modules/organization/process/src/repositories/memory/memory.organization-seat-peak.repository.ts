import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import {
  OrganizationSeatPeakRepository,
  type SeatPeakFoldState,
} from "../organization-seat-peak.repository.ts";

/** The seat-peak fold's rows in memory: the twin of the Postgres projection row. */
export class MemoryOrganizationSeatPeakRepository extends OrganizationSeatPeakRepository {
  static create(): MemoryOrganizationSeatPeakRepository {
    return new MemoryOrganizationSeatPeakRepository();
  }

  private readonly rows = new Map<string, StoredProjection<SeatPeakFoldState>>();

  private constructor() {
    super();
  }

  async get(
    organizationId: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<SeatPeakFoldState>> {
    const projection = this.rows.get(organizationId);
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<SeatPeakFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.set(context.aggregateId, projection);
  }

  async findState(organizationId: string): Promise<SeatPeakFoldState | null> {
    return this.rows.get(organizationId)?.state ?? null;
  }
}

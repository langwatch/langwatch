export interface StorageBillableGaugeRow {
  organizationId: string;
  billableBytes: bigint;
  lastEventAt: Date;
}

/**
 * Read side of the materialized fold result. Writes happen exclusively
 * through StorageBoundaryEventRepository.append (event + increment in one
 * transaction) — there is deliberately no free-standing gauge write here:
 * a gauge value that doesn't trace to a boundary event is an invoice line
 * no operator ever saw.
 */
export interface StorageBillableGaugeRepository {
  findByOrganization(params: {
    organizationId: string;
  }): Promise<StorageBillableGaugeRow | null>;
}

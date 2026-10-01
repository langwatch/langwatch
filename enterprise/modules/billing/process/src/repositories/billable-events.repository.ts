export type BillableEventsWindow = {
  /** UTC ClickHouse DateTime64(3): `YYYY-MM-DD HH:mm:ss.SSS`, with no offset suffix. */
  startDate: string;
  /** UTC ClickHouse DateTime64(3): `YYYY-MM-DD HH:mm:ss.SSS`, with no offset suffix. */
  endDate: string;
};

export abstract class BillableEventsRepository {
  abstract findTotal(input: { organizationId: string } & BillableEventsWindow): Promise<number>;
  abstract findTotalUniq(input: { organizationId: string } & BillableEventsWindow): Promise<number>;
  abstract findByProjectApprox(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<{ projectId: string; count: number }[]>;
  abstract findByProject(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<{ projectId: string; count: number }[]>;
}

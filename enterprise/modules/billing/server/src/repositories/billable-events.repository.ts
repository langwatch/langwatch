export type BillableEventsWindow = {
  startDate: string;
  endDate: string;
};

export abstract class BillableEventsRepository {
  abstract findTotal(input: { organizationId: string } & BillableEventsWindow): Promise<number>;
  abstract findTotalUniq(input: { organizationId: string } & BillableEventsWindow): Promise<number>;
  abstract findTraceSummariesTotalUniq(
    input: { tenantIds: string[] } & BillableEventsWindow,
  ): Promise<number>;
  abstract findByProjectApprox(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<Array<{ projectId: string; count: number }>>;
  abstract findByProject(
    input: { organizationId: string } & BillableEventsWindow,
  ): Promise<Array<{ projectId: string; count: number }>>;
}

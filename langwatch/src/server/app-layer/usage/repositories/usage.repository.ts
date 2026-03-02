export interface BillableEventsAggregate {
  projectId: string;
  count: number;
}

export interface UsageRepository {
  sumBillableEvents(params: {
    projectIds: string[];
    fromDate: string;
  }): Promise<number>;

  groupBillableEventsByProject(params: {
    projectIds: string[];
    fromDate: string;
  }): Promise<BillableEventsAggregate[]>;
}

export class NullUsageRepository implements UsageRepository {
  async sumBillableEvents(
    _params: { projectIds: string[]; fromDate: string },
  ): Promise<number> {
    return 0;
  }

  async groupBillableEventsByProject(
    _params: { projectIds: string[]; fromDate: string },
  ): Promise<BillableEventsAggregate[]> {
    return [];
  }
}

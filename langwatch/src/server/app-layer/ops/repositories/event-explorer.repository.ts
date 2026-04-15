export interface AggregateDiscoveryRow {
  aggregateType: string;
  tenantId: string;
  aggregateCount: number;
}

export interface AggregateSearchResult {
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  eventCount: number;
  lastEventTime: string;
}

export interface RawEventRow {
  eventId: string;
  eventType: string;
  eventTimestamp: string;
  payload: string;
}

export interface EventExplorerRepository {
  findAggregates(params: {
    aggregateTypes: string[];
    sinceMs: number;
    tenantIds?: string[];
  }): Promise<AggregateDiscoveryRow[]>;

  searchAggregates(params: {
    query: string;
    tenantIds?: string[];
  }): Promise<AggregateSearchResult[]>;

  findEventsByAggregate(params: {
    aggregateId: string;
    tenantId: string;
    limit: number;
  }): Promise<RawEventRow[]>;
}

export class NullEventExplorerRepository implements EventExplorerRepository {
  async findAggregates(): Promise<AggregateDiscoveryRow[]> {
    return [];
  }

  async searchAggregates(): Promise<AggregateSearchResult[]> {
    return [];
  }

  async findEventsByAggregate(): Promise<RawEventRow[]> {
    return [];
  }
}

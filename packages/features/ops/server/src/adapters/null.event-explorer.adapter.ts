import type { AggregateSearchResult } from "@langwatch/ops-contract";
import type {
  AggregateDiscoveryRow,
  EventExplorerRepository,
  RawEventRow,
} from "../repositories/event-explorer.repository";

export class NullEventExplorerAdapter implements EventExplorerRepository {
  static create(): NullEventExplorerAdapter {
    return new NullEventExplorerAdapter();
  }

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

import type { AggregateSearchResult } from "@langwatch/ops-contract";
import type {
  AggregateDiscoveryRow,
  EventExplorerRepository,
  RawEventRow,
} from "../repositories/event-explorer.repository";

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

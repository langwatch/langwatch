import {
  SsoConnectionHistoryRepository,
  type SsoConnectionHistoryEntry,
} from "../sso-connection-history.repository.ts";

interface HeldFact {
  organizationId: string;
  connectionId: string;
  entry: SsoConnectionHistoryEntry;
}

/** A connection's history over the facts a test hands it; a fresh one holds none. */
export class MemorySsoConnectionHistoryRepository extends SsoConnectionHistoryRepository {
  static create(): MemorySsoConnectionHistoryRepository {
    return new MemorySsoConnectionHistoryRepository();
  }

  readonly #facts: HeldFact[] = [];

  private constructor() {
    super();
  }

  add(fact: HeldFact): void {
    this.#facts.push(fact);
  }

  async findHistory({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly SsoConnectionHistoryEntry[]> {
    return this.#facts
      .filter(
        (fact) => fact.organizationId === organizationId && fact.connectionId === connectionId,
      )
      .map((fact) => fact.entry)
      .toSorted((a, b) => b.occurredAtMs - a.occurredAtMs || b.eventId.localeCompare(a.eventId))
      .slice(0, limit);
  }
}

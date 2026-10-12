import type {
  EventingParticipation,
  OwnEventStore,
  OwnEventsAppend,
  PriorEventsQuery,
} from "@langwatch/eventing";

type OwnEventOperation = "append" | "read";

/**
 * Each identity pipeline's own event store, kept as the process builds it (record §7, Alex,
 * 2026-10-05). The app is composed before its pipelines are built, so a ledger or history
 * holds `of(...)`, which reaches the kept store per call and refuses by name while there is none.
 */
export class IdentityEventStores {
  static create(): IdentityEventStores {
    return new IdentityEventStores();
  }

  readonly #stores = new Map<string, OwnEventStore>();

  private constructor() {}

  /** A build only to be listed keeps nothing: in a producer role it runs after registration. */
  keep(input: {
    pipeline: string;
    participation: EventingParticipation;
    eventStore: OwnEventStore | undefined;
  }): void {
    if (input.participation === "describe" || input.eventStore === void 0) return;
    this.#stores.set(input.pipeline, input.eventStore);
  }

  holds(input: { pipeline: string }): boolean {
    return this.#stores.has(input.pipeline);
  }

  of(input: { pipeline: string }): OwnEventStore {
    const { pipeline } = input;
    return {
      append: (appended: OwnEventsAppend) =>
        this.#kept({ pipeline, operation: "append" }).append(appended),
      read: <Event>(query: PriorEventsQuery<Event>) =>
        this.#kept({ pipeline, operation: "read" }).read(query),
    };
  }

  #kept(input: { pipeline: string; operation: OwnEventOperation }): OwnEventStore {
    const store = this.#stores.get(input.pipeline);
    if (store) return store;
    // A plain Error on purpose (error doctrine): the caller cannot act on an absent log.
    throw new Error(
      `identity's ${input.pipeline} pipeline cannot ${input.operation}: this process never built it over an event store`,
    );
  }
}

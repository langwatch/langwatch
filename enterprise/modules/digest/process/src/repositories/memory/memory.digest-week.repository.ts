// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

type WeekState = Readonly<{ organizationId: string; isoWeek: string }>;

/** A week fold held by this process: the projection store and its reads. */
export class MemoryDigestWeekRepository<State extends WeekState> {
  static create<State extends WeekState>(): MemoryDigestWeekRepository<State> {
    return new MemoryDigestWeekRepository<State>();
  }

  readonly #rows = new Map<string, StoredProjection<State>>();

  private constructor() {}

  get = (key: string, _context: ProjectionStoreContext): Promise<StoredProjectionRead<State>> => {
    const projection = this.#rows.get(key);
    return Promise.resolve(projection ? { kind: "folded", projection } : { kind: "empty" });
  };

  store = (projection: StoredProjection<State>, context: ProjectionStoreContext): Promise<void> => {
    this.#rows.set(context.aggregateId, projection);
    return Promise.resolve();
  };

  listWeeks({
    isoWeeks,
    organizationId,
  }: {
    isoWeeks: readonly string[];
    organizationId?: string;
  }): Promise<State[]> {
    return Promise.resolve(
      [...this.#rows.values()]
        .map((row) => row.state)
        .filter(
          (state) =>
            isoWeeks.includes(state.isoWeek) &&
            (organizationId === undefined || state.organizationId === organizationId),
        ),
    );
  }

  deleteBefore({ isoWeek }: { isoWeek: string }): Promise<number> {
    let dropped = 0;
    for (const [key, row] of this.#rows) {
      if (row.state.isoWeek < isoWeek) {
        this.#rows.delete(key);
        dropped += 1;
      }
    }
    return Promise.resolve(dropped);
  }
}

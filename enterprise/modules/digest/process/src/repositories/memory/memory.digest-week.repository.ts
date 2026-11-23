// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

/** A person's week names them; a project's week names no one. */
type WeekState = Readonly<{ organizationId: string; isoWeek: string; userId?: string }>;

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
    this.#rows.set(context.key ?? context.aggregateId, projection);
    return Promise.resolve();
  };

  findWeeks({
    isoWeeks,
    organizationId,
  }: {
    isoWeeks: readonly string[];
    organizationId: string;
  }): Promise<State[]> {
    return Promise.resolve(
      [...this.#rows.values()]
        .map((row) => row.state)
        .filter(
          (state) => state.organizationId === organizationId && isoWeeks.includes(state.isoWeek),
        ),
    );
  }

  forgetUser({ userId }: { userId: string }): Promise<void> {
    for (const [key, row] of this.#rows) {
      if (row.state.userId === userId) this.#rows.delete(key);
    }
    return Promise.resolve();
  }

  deleteBefore({ isoWeek }: { isoWeek: string }): Promise<void> {
    for (const [key, row] of this.#rows) {
      if (row.state.isoWeek < isoWeek) this.#rows.delete(key);
    }
    return Promise.resolve();
  }
}

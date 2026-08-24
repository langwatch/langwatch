import type { Where } from "better-auth";
import type { DbAdapter } from "./adapter-types";

/**
 * The row reads a ceremony takes before a destructive write, and the
 * narrowing that write then uses. Both halves of one rule — THE ROWS THE
 * CEREMONY SAW ARE THE ROWS THE WRITE REMOVES — so they live on one object
 * rather than as two loose helpers a future caller could use only half of.
 */
export class AdapterRows {
  /** `findMany` defaults its limit to 100; a page bigger than this is paged. */
  private static readonly PAGE_SIZE = 100;

  constructor(
    private readonly base: Pick<DbAdapter, "findMany" | "findOne">,
  ) {}

  /** One row, or null — the ceremonies' only single-row read. */
  async findOne<Row>({
    model,
    where,
  }: {
    model: string;
    where: Where[];
  }): Promise<Row | null> {
    return this.base.findOne<Row>({ model, where });
  }

  /**
   * Every row matching the predicate, not the first hundred. The adapter's
   * `findMany` defaults `limit` to 100 when none is given, so a ceremony
   * selection over an unbounded predicate would silently see one page — and
   * `pinTo` would then narrow the protocol delete to that subset, leaving
   * the rest standing. Ordered by id so offset paging is stable.
   */
  async findAll<Row extends { id: string }>({
    model,
    where,
  }: {
    model: string;
    where: Where[] | undefined;
  }): Promise<Row[]> {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += AdapterRows.PAGE_SIZE) {
      const page = await this.base.findMany<Row>({
        model,
        where,
        limit: AdapterRows.PAGE_SIZE,
        offset,
        sortBy: { field: "id", direction: "asc" },
      });
      rows.push(...page);
      if (page.length < AdapterRows.PAGE_SIZE) return rows;
    }
  }

  /**
   * Re-evaluating the caller's `where` after the ceremonies ran could delete
   * a row the ceremony never covered (one that started matching mid-flight)
   * or leave an erased user's row standing under a changed predicate.
   * Pinning the write to the ids the ceremony selected makes the two sets
   * identical either way.
   */
  pinTo<Args extends { where: Where[] }>(args: Args, ids: string[]): Args {
    return {
      ...args,
      where: [
        ids.length === 1
          ? { field: "id", value: ids[0] as string }
          : { field: "id", operator: "in" as const, value: ids },
      ],
    };
  }
}

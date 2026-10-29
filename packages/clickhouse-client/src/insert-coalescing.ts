/**
 * Async inserts that wait for a statement slot together go as one statement (ADR-187), so the
 * slots a burst needs follow the tables being written, not the rows.
 */

/** Rows one coalesced statement carries at most; an insert that is larger travels alone. */
export const DEFAULT_INSERT_COALESCE_MAX_ROWS = 5_000;

/** The parameters a coalesced insert may carry: anything else (a signal, a query id) runs alone. */
const COALESCIBLE_KEYS = new Set(["table", "values", "format", "clickhouse_settings"]);

/** What a batch runs on: the admission it waits in, and the driver's own insert. */
export interface CoalescedInsertRunner {
  /**
   * Waits for an insert slot, then runs `task`; past the bound, refuses with the overload error
   * and counts `callers()` shed, read once at the refusal.
   */
  admit<T>(task: () => Promise<T>, callers: () => number): Promise<T>;
  /** The vendor insert, under the slot already granted. */
  insert(params: Record<string, unknown>): Promise<unknown>;
}

interface Member {
  params: Record<string, unknown>;
  rows: readonly unknown[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface Batch {
  key: string;
  members: Member[];
  rows: number;
  open: boolean;
}

/** The batch key of an insert that may travel with others, or null when it must run alone. */
export function coalesceKeyOf(params: unknown): string | null {
  if (params === null || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const foreign = Object.keys(record).some((key) => !COALESCIBLE_KEYS.has(key));
  if (foreign) return null;
  const { table, values, format, clickhouse_settings: settings } = record;
  if (typeof table !== "string" || typeof format !== "string") return null;
  if (!Array.isArray(values)) return null;
  if (settings === null || typeof settings !== "object") return null;
  const own = settings as Record<string, unknown>;
  if (!isOn(own.async_insert) || !isOn(own.wait_for_async_insert)) return null;
  const sorted = Object.keys(own)
    .toSorted()
    .map((name) => [name, own[name]]);
  return JSON.stringify([table, format, sorted]);
}

function isOn(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

/** Joins async inserts into open batches per key, and settles every member with its own outcome. */
export class InsertCoalescer {
  private readonly open = new Map<string, Batch>();

  constructor(
    private readonly runner: CoalescedInsertRunner,
    private readonly maxRows: number = DEFAULT_INSERT_COALESCE_MAX_ROWS,
  ) {}

  /** Runs `params` with the open batch of its key, or starts one; null when it cannot coalesce. */
  submit(params: unknown): Promise<unknown> | null {
    if (this.maxRows <= 0) return null;
    const key = coalesceKeyOf(params);
    if (key === null) return null;
    const record = params as Record<string, unknown>;
    const rows = record.values as readonly unknown[];
    const joined = this.open.get(key);
    const batch =
      joined !== undefined && joined.rows + rows.length <= this.maxRows
        ? joined
        : { key, members: [], rows: 0, open: true };
    const settled = new Promise((resolve, reject) => {
      batch.members.push({ params: record, rows, resolve, reject });
      batch.rows += rows.length;
    });
    if (batch !== joined) {
      this.open.set(key, batch);
      void this.start(batch);
    }
    return settled;
  }

  /** Sends the batch once admitted and settles its members; never rejects. */
  private async start(batch: Batch): Promise<void> {
    let admitted = false;
    try {
      // The batch closes when its slot is granted, or when it is refused: no caller joins a
      // statement that has started, nor one refused after the shed count was taken.
      const result = await this.runner.admit(
        () => {
          admitted = true;
          this.close(batch);
          return this.send(batch);
        },
        () => {
          this.close(batch);
          return batch.members.length;
        },
      );
      for (const member of batch.members) member.resolve(result);
    } catch (error) {
      this.close(batch);
      if (!admitted || batch.members.length === 1) {
        for (const member of batch.members) member.reject(error);
        return;
      }
      // The statement failed after it was admitted: a row only one caller sent may be the
      // cause, so each caller retries alone and fails, or succeeds, on its own rows.
      for (const member of batch.members) void this.alone(member);
    }
  }

  private send(batch: Batch): Promise<unknown> {
    const [first, ...rest] = batch.members;
    if (first === undefined) return Promise.resolve(undefined);
    if (rest.length === 0) return this.runner.insert(first.params);
    return this.runner.insert({
      ...first.params,
      values: batch.members.flatMap((member) => member.rows),
    });
  }

  /** Sends one member's rows in a statement of their own and settles it; never rejects. */
  private async alone(member: Member): Promise<void> {
    try {
      member.resolve(
        await this.runner.admit(
          () => this.runner.insert(member.params),
          () => 1,
        ),
      );
    } catch (error) {
      member.reject(error);
    }
  }

  private close(batch: Batch): void {
    if (!batch.open) return;
    batch.open = false;
    if (this.open.get(batch.key) === batch) this.open.delete(batch.key);
  }
}

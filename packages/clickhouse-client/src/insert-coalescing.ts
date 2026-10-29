/**
 * Async inserts that wait for a statement slot together go as one statement (ADR-187), so the
 * slots a burst needs follow the tables being written, not the rows.
 */
import type { InsertRequest } from "./query.ts";

/** Rows one coalesced statement carries at most; an insert that is larger travels alone. */
export const DEFAULT_INSERT_COALESCE_MAX_ROWS = 5_000;

/**
 * ClickHouse codes that reject a statement's rows unwritten: the data did not parse or convert.
 * Anything else may have written the batch (ADR-187, decision 5).
 */
const ROWS_REJECTED_CODES: ReadonlySet<string> = new Set([
  "6", // CANNOT_PARSE_TEXT
  "26", // CANNOT_PARSE_QUOTED_STRING
  "27", // CANNOT_PARSE_INPUT_ASSERTION_FAILED
  "38", // CANNOT_PARSE_DATE
  "41", // CANNOT_PARSE_DATETIME
  "53", // TYPE_MISMATCH
  "70", // CANNOT_CONVERT_TYPE
  "72", // CANNOT_PARSE_NUMBER
  "117", // INCORRECT_DATA
  "349", // CANNOT_INSERT_NULL_IN_ORDINARY_COLUMN
]);

/** Whether the server refused a statement's rows before writing any of them. */
export function rejectedTheRows(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string" && typeof code !== "number") return false;
  return ROWS_REJECTED_CODES.has(String(code));
}

/** What a batch runs on: the admission it waits in, and the client's own sends. */
export interface CoalescedInsertRunner<Request> {
  /** Whether the insert lane grants a slot now, with nothing waiting: then an insert goes alone. */
  admitsNow(): boolean;
  /**
   * Waits for an insert slot, then runs `task`; past the bound, refuses with the overload error
   * and counts `callers()` shed, read once at the refusal.
   */
  admit<T>(task: () => Promise<T>, callers: () => number): Promise<T>;
  /** Sends every request's rows as one statement, under the slot already granted. */
  send(requests: readonly Request[]): Promise<void>;
  /** Sends one request on its own, under its own admission. */
  alone(request: Request): Promise<void>;
}

interface Member<Request> {
  request: Request;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface Batch<Request> {
  key: string;
  members: Member<Request>[];
  rows: number;
  open: boolean;
}

/**
 * The batch key of an insert that may travel with others, or null when it must run alone: the
 * route, so a batch routes and is guarded as each insert, and an explicit async insert that waits
 * for the flush with deduplication off, whose identity a batch cannot change (ADR-187).
 */
export function coalesceKeyOf(request: InsertRequest): string | null {
  if (request.signal !== undefined || request.rows.length === 0) return null;
  const settings = request.settings;
  if (settings === undefined) return null;
  if (!isOn(settings.async_insert) || !isOn(settings.wait_for_async_insert))
    return null;
  if (!isOff(settings.async_insert_deduplicate)) return null;
  if ("insert_deduplication_token" in settings) return null;
  const sorted = Object.keys(settings)
    .toSorted()
    .map((name) => [name, settings[name]]);
  return JSON.stringify([
    request.tenantId,
    request.organizationId ?? null,
    request.tenantIds === undefined ? null : [...request.tenantIds].toSorted(),
    request.SKIP_TENANT_CHECK === true,
    request.table,
    sorted,
  ]);
}

function isOn(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

function isOff(value: unknown): boolean {
  return value === 0 || value === "0" || value === false;
}

/** Joins async inserts into open batches per key, and settles every member with its own outcome. */
export class InsertCoalescer<Request extends { rows: readonly unknown[] }> {
  private readonly open = new Map<string, Batch<Request>>();

  constructor(
    private readonly runner: CoalescedInsertRunner<Request>,
    private readonly maxRows: number = DEFAULT_INSERT_COALESCE_MAX_ROWS,
  ) {}

  /**
   * Runs `request` with the open batch of `key`, or starts one; null when it goes alone: it
   * cannot coalesce, it fills a statement by itself, or a slot is free for it now.
   */
  submit(request: Request, key: string | null): Promise<void> | null {
    if (this.maxRows <= 0 || key === null) return null;
    const rows = request.rows.length;
    // Every member brings a row, so the row cap also bounds the callers one batch holds.
    if (rows === 0 || rows >= this.maxRows) return null;
    const joined = this.open.get(key);
    const fits = joined !== undefined && joined.rows + rows <= this.maxRows;
    // A batch opens only for an insert that would wait: with a slot free it goes at once, alone.
    if (!fits && this.runner.admitsNow()) return null;
    const batch: Batch<Request> =
      fits && joined !== undefined
        ? joined
        : { key, members: [], rows: 0, open: true };
    const settled = new Promise<void>((resolve, reject) => {
      batch.members.push({ request, resolve, reject });
      batch.rows += rows;
    });
    if (batch !== joined) {
      this.open.set(key, batch);
      void this.start(batch);
    }
    return settled;
  }

  /** Sends the batch once admitted and settles its members; never rejects. */
  private async start(batch: Batch<Request>): Promise<void> {
    let admitted = false;
    try {
      // The batch closes when its slot is granted, or when it is refused: no caller joins a
      // statement that has started, nor one refused after the shed count was taken.
      await this.runner.admit(
        () => {
          admitted = true;
          this.close(batch);
          return this.runner.send(
            batch.members.map((member) => member.request),
          );
        },
        () => {
          this.close(batch);
          return batch.members.length;
        },
      );
      for (const member of batch.members) member.resolve();
    } catch (error) {
      this.close(batch);
      if (!admitted || batch.members.length === 1 || !rejectedTheRows(error)) {
        // Refused, alone, or a failure that may have written the batch: a resend could write
        // the rows twice, so every caller gets the failure its own insert would have had.
        for (const member of batch.members) member.reject(error);
        return;
      }
      // The server rejected the rows unwritten: a row only one caller sent may be the cause, so
      // each caller resends alone and fails, or succeeds, on its own rows.
      for (const member of batch.members) void this.alone(member);
    }
  }

  /** Sends one member's rows in a statement of their own and settles it; never rejects. */
  private async alone(member: Member<Request>): Promise<void> {
    try {
      await this.runner.alone(member.request);
      member.resolve();
    } catch (error) {
      member.reject(error);
    }
  }

  private close(batch: Batch<Request>): void {
    if (!batch.open) return;
    batch.open = false;
    if (this.open.get(batch.key) === batch) this.open.delete(batch.key);
  }
}

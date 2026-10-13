/** One append's rows, the tenant they belong to, and how to answer the job that sent them. */
interface WaitingAppend {
  readonly tenantId: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly settle: (error?: unknown) => void;
}

/** One insert: one tenant's rows, or several tenants' rows under the set they declare. */
export interface EventLogInsert {
  readonly tenantId: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly tenantIds?: readonly string[];
}

interface FoldLane {
  waiting: WaitingAppend[];
  inFlight: number;
}

/**
 * Folds appends bound for one organisation's server into shared inserts declaring their tenant
 * set (Alex, 2026-10-12): an append leaves alone while an insert is free, later ones fold into
 * the next, and a failed shared insert is retried as each append alone.
 */
export class EventLogAppendFold {
  private readonly lanes = new Map<string, FoldLane>();

  constructor(
    private readonly options: {
      readonly insert: (insert: EventLogInsert) => Promise<void>;
      /** Inserts one organisation holds at once; appends past it wait and fold. */
      readonly maxInFlight: number;
      /** Rows one shared insert carries at most; one append always goes out whole. */
      readonly maxRows: number;
    },
  ) {}

  append({
    organizationId,
    tenantId,
    rows,
  }: {
    organizationId: string;
    tenantId: string;
    rows: readonly Readonly<Record<string, unknown>>[];
  }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const lane = this.laneOf(organizationId);
      lane.waiting.push({
        tenantId,
        rows,
        settle: (error) => (error === undefined ? resolve() : reject(error)),
      });
      this.drain(organizationId, lane);
    });
  }

  private laneOf(organizationId: string): FoldLane {
    const existing = this.lanes.get(organizationId);
    if (existing !== undefined) return existing;
    const lane: FoldLane = { waiting: [], inFlight: 0 };
    this.lanes.set(organizationId, lane);
    return lane;
  }

  private drain(organizationId: string, lane: FoldLane): void {
    while (lane.inFlight < this.options.maxInFlight && lane.waiting.length > 0) {
      const batch = this.takeBatch(lane);
      lane.inFlight++;
      void this.send(batch).finally(() => {
        lane.inFlight--;
        if (lane.inFlight === 0 && lane.waiting.length === 0) this.lanes.delete(organizationId);
        else this.drain(organizationId, lane);
      });
    }
  }

  private takeBatch(lane: FoldLane): WaitingAppend[] {
    const batch = [lane.waiting.shift()!];
    let rows = batch[0]!.rows.length;
    for (let next = lane.waiting[0]; next !== undefined; next = lane.waiting[0]) {
      if (rows + next.rows.length > this.options.maxRows) break;
      lane.waiting.shift();
      rows += next.rows.length;
      batch.push(next);
    }
    return batch;
  }

  private async send(batch: readonly WaitingAppend[]): Promise<void> {
    if (batch.length === 1) {
      await this.alone(batch[0]!);
      return;
    }
    try {
      await this.options.insert({
        tenantId: batch[0]!.tenantId,
        rows: batch.flatMap((append) => append.rows),
        tenantIds: [...new Set(batch.map((append) => append.tenantId))],
      });
    } catch {
      await Promise.all(batch.map((append) => this.alone(append)));
      return;
    }
    for (const append of batch) append.settle();
  }

  private async alone(append: WaitingAppend): Promise<void> {
    try {
      await this.options.insert({ tenantId: append.tenantId, rows: append.rows });
      append.settle();
    } catch (error) {
      append.settle(error ?? new Error("event log insert failed"));
    }
  }
}

import type {
  StaffAccessEventRepository,
  StaffAccessEventRow,
} from "../staff-access.repository.ts";

export class MemoryStaffAccessEventRepository implements StaffAccessEventRepository {
  readonly #rows = new Map<string, StaffAccessEventRow>();
  /** A test turns this on to prove a failed trail write refuses the request. */
  refuseWrites = false;

  static create(): MemoryStaffAccessEventRepository {
    return new MemoryStaffAccessEventRepository();
  }

  async create(row: StaffAccessEventRow): Promise<void> {
    if (this.refuseWrites) throw new Error("the trail store refused the write");
    this.#rows.set(row.id, row);
  }

  async finish(input: {
    id: string;
    status: number;
    errorCode: string | null;
    durationMs: number;
  }): Promise<void> {
    const row = this.#rows.get(input.id);
    if (!row) return;
    this.#rows.set(input.id, {
      ...row,
      status: input.status,
      errorCode: input.errorCode,
      durationMs: input.durationMs,
    });
  }

  async findByRequest({ requestId }: { requestId: string }): Promise<StaffAccessEventRow[]> {
    return [...this.#rows.values()].filter((row) => row.requestId === requestId);
  }
}

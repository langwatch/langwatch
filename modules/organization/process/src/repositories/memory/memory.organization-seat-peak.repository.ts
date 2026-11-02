import type { SeatHolder } from "../../rules/seat-holder.rules.ts";
import {
  type SeatPeakCountsRow,
  type SeatPeakHolderRow,
  seatPeakWrites,
} from "../../rules/seat-peak-writes.rules.ts";
import {
  emptySeatPeak,
  type SeatPeakMonth,
  type SeatPeakState,
} from "../../rules/seat-peak.rules.ts";
import {
  OrganizationSeatPeakRepository,
  type SeatPeakSlice,
} from "../organization-seat-peak.repository.ts";

type OrganizationRows = {
  counts: SeatPeakCountsRow;
  holders: Map<string, SeatPeakHolderRow>;
  months: Map<string, SeatPeakMonth>;
};

/** The seat peak's rows in memory: the twin of the Postgres tables, loading the same slice. */
export class MemoryOrganizationSeatPeakRepository extends OrganizationSeatPeakRepository {
  static create(): MemoryOrganizationSeatPeakRepository {
    return new MemoryOrganizationSeatPeakRepository();
  }

  private readonly organizations = new Map<string, OrganizationRows>();

  private constructor() {
    super();
  }

  async getState(slice: SeatPeakSlice): Promise<SeatPeakState> {
    return this.#load(slice);
  }

  async update(slice: SeatPeakSlice, fold: (state: SeatPeakState) => SeatPeakState): Promise<void> {
    const before = this.#load(slice);
    const writes = seatPeakWrites({ before, after: fold(before) });
    const stored = this.organizations.get(slice.organizationId);
    if (writes.counts === null && stored === undefined) return;
    const rows = stored ?? { counts: writes.counts!, holders: new Map(), months: new Map() };
    if (writes.counts !== null) rows.counts = writes.counts;
    for (const row of [...writes.createdHolders, ...writes.updatedHolders]) {
      rows.holders.set(`${row.kind}:${row.holderId}`, row);
    }
    for (const { month, values } of writes.months) rows.months.set(month, values);
    this.organizations.set(slice.organizationId, rows);
  }

  #load(slice: SeatPeakSlice): SeatPeakState {
    const rows = this.organizations.get(slice.organizationId);
    if (rows === undefined) return emptySeatPeak();
    const dueBefore = Math.max(slice.dueBefore, rows.counts.latestChangeAt);
    const state: SeatPeakState = {
      ...rows.counts,
      members: {},
      invitations: {},
      months: Object.fromEntries(rows.months),
    };
    for (const row of rows.holders.values()) {
      if (!inSlice({ row, slice, dueBefore })) continue;
      if (row.kind === "member") state.members[row.holderId] = row.holding;
      else state.invitations[row.holderId] = row.holding;
    }
    return state;
  }
}

/** Whether a holder row loads for the slice: named, or a seated invitation due to expire. */
function inSlice({
  row,
  slice,
  dueBefore,
}: {
  row: SeatPeakHolderRow;
  slice: SeatPeakSlice;
  dueBefore: number;
}): boolean {
  const seated = row.holding.seat !== "none";
  if (slice.holders === "seated" && seated) return true;
  if (slice.holders !== "seated" && slice.holders.some((holder) => names({ holder, row }))) {
    return true;
  }
  if (row.kind === "member" || !seated) return false;
  return row.holding.expiresAt !== null && row.holding.expiresAt < dueBefore;
}

function names({ holder, row }: { holder: SeatHolder; row: SeatPeakHolderRow }): boolean {
  if (holder.kind === "member") return row.kind === "member" && row.holderId === holder.userId;
  return row.kind === "invitation" && row.holderId === holder.inviteId;
}

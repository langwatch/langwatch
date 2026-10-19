// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One row of the tRPC spender DTO, as the panel receives it. */
export interface SpenderRow {
  provider: string;
  rawActorId: string;
  /** Null only on the not-named bucket row. */
  label: string | null;
  agentId: string;
  amountUsd: number | null;
  cellsWithoutAmount: number;
}

/**
 * The pulled lane's spender read. `rows` is null while unanswered — the read
 * is refused without the People screen's permission — and a failure is carried
 * separately, because hiding the panel on an outage would claim nobody spent
 * anything.
 */
export interface SpenderReadState {
  rows: SpenderRow[] | null;
  isError: boolean;
  /** Declined by the plan gate or a missing grant, rather than broken. */
  refused: boolean;
  /** Whether it is in flight, for the refresh control. Same reason as the rest. */
  isFetching: boolean;
  retry: () => void;
}

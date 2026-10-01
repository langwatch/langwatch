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

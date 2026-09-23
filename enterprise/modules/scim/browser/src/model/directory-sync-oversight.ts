// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The back office's reading of one directory sync (ADR-122). */

/** Colour tracks whether a customer's directory is doing its job. */
const STATE_PALETTE: Record<string, string> = {
  TOKEN_ISSUED: "gray",
  SYNCING: "green",
  ERROR: "red",
  REVOKED: "gray",
};

export function syncStatePalette(state: string): string {
  return STATE_PALETTE[state] ?? "gray";
}

/** The state as a word an operator reads, not a constant: `TOKEN_ISSUED` → `token issued`. */
export function syncStateWords(state: string): string {
  return state.replace(/_/g, " ").toLowerCase();
}

/**
 * A retired apply that may be sent through again: one that was retired and has
 * not been sent already. Offering it twice invites an act whose only answer is
 * that it is done.
 */
export function redrivableAt(letter: {
  retiredAtMs: number | null;
  redrivenAtMs: number | null;
}): number | undefined {
  if (letter.redrivenAtMs !== null || letter.retiredAtMs === null) return void 0;
  return letter.retiredAtMs;
}

/** The connection the drawer is open on, as the address carries it. */
export const OPEN_CONNECTION_PARAM = "connection";

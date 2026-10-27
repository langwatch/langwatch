// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The ways back in, as the organization's own page reads them (D05). A
 * renewal writes a new grant naming the one it replaced, so what is offered
 * for extending or ending is only ever what is live right now.
 */

/** One grant: who holds it, who gave it, and when it ends. */
export interface BreakGlassGrantView {
  bindingId: string;
  userId: string;
  name: string | null;
  email: string | null;
  /** Named on the row, because a way back in is never self-served. */
  grantedByName: string | null;
  expiresAtMs: number;
  daysRemaining: number;
  live: boolean;
}

/** Somebody a way back in can be granted to: an administrator, today. */
export interface BreakGlassCandidateView {
  userId: string;
  name: string | null;
  email: string | null;
  /**
   * Whether they could actually walk through the door. Listed rather than
   * filtered out: a name silently missing from a picker teaches nobody why.
   */
  holdsPassword?: boolean;
}

/** Superseded rows are history and expired ones are over. */
export function liveBreakGlassGrants(
  grants: readonly BreakGlassGrantView[],
): BreakGlassGrantView[] {
  return grants.filter((grant) => grant.live);
}

/** A person, wherever we have one — the id is the last resort, not the label. */
export function breakGlassHolderName(grant: BreakGlassGrantView): string {
  return grant.name ?? grant.email ?? grant.userId;
}

/** What a candidate is called in the picker, with why they cannot hold one. */
export function breakGlassCandidateLabel(candidate: BreakGlassCandidateView): string {
  const name = candidate.name ?? candidate.email ?? candidate.userId;

  return candidate.holdsPassword === false ? `${name} (set a password first)` : name;
}

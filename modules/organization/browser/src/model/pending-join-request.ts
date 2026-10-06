/**
 * One waiting request, as the panel needs it — the requester's ADDRESS is
 * not here, only the domain matched and what an admin is deciding on. Lives
 * here since the producing query is behavior and the table is a block.
 */
export interface PendingJoinRequest {
  joinRequestId: string;
  name: string;
  domain: string;
  /** ISO 8601: the wire carries these instants as text. */
  requestedAt: string;
  expiresAt: string | null;
  /** The seat approval lands (ADR-171 v6): shown, never edited; approval carries no role. */
  seat: "MEMBER" | "DEVELOPER";
}

/** One person who walked in on the domain setting: the domain admitted them, so no address. */
export interface AutomaticJoin {
  joinRequestId: string;
  name: string;
  domain: string;
  joinedAt: string | null;
}

import type { Instant } from "@langwatch/time";

/** One dispatch's sends, counted into a fixed window once however often a retry repeats it. */
export type EmailCapSend = Readonly<{
  /** The window's counter; its identity carries the window's bucket. */
  window: string;
  /** The dispatch's own claim: a second claim of one dispatch counts nothing. */
  claim: string;
  /** What the dispatch counts: one per dispatch hourly, its recipients daily. */
  sends: number;
  /** How long the window and its claims are held, beyond the window itself. */
  ttlSeconds: number;
  now: Instant;
}>;

export type EmailCapClaim =
  | Readonly<{ outcome: "counted"; count: number }>
  | Readonly<{ outcome: "already-counted" }>;

/** The email ceilings' counters: fixed windows of sends, claimed once per dispatch. */
export abstract class AutomationEmailCapRepository {
  /** Claims the dispatch and counts its sends into the window; a repeated claim counts nothing. */
  abstract claimSend(send: EmailCapSend): Promise<EmailCapClaim>;
  /** The sends counted into the window so far; zero once the window has lapsed. */
  abstract countSends(input: Readonly<{ window: string; now: Instant }>): Promise<number>;
}

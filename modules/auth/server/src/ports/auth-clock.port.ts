import type { Instant } from "@langwatch/time";

/** Process time is injected so browser-session expiry has deterministic tests. */
export abstract class AuthClockPort {
  abstract now(): Instant;
}

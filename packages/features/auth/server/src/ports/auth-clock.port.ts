/** Process time is injected so browser-session expiry has deterministic tests. */
export abstract class AuthClockPort {
  abstract now(): Date;
}

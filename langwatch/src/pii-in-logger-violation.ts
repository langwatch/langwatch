// Smoke-test for issue #3754 — DO NOT MERGE.
// Expect semgrep `pii-in-logger-call` to flag every call below.

import { logger } from "./logger-stub";

interface User {
  id: string;
  email: string;
  apiKey: string;
}

export function violation_literalKey(user: User): void {
  // Literal `email` key in object literal.
  logger.info({ event: "signin", email: user.email });
}

export function violation_userIdAndToken(user: User, token: string): void {
  logger.warn({ event: "auth", userId: user.id, token });
}

export function violation_spreadUser(user: User): void {
  // Spread of a `User`-shaped object.
  logger.info({ event: "signin", ...user });
}

export function violation_userShorthand(user: User): void {
  // Shorthand property with name = "user".
  logger.error({ event: "signin_failed", user });
}

export function violation_consoleApiKey(apiKey: string): void {
  console.warn({ tag: "key_seen", apiKey });
}

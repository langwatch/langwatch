import type { Authorization } from "@langwatch/actor";

/**
 * The proof a procedure's `.permission()` mint left on the context, for a
 * read that applies it (ADR-144 block C). A procedure that reaches such a
 * read without the mint is a programming error, not a customer's, so it
 * fails as a plain error with the trace id rather than a handled one.
 */
export function requireRouteAuthorization(ctx: {
  authorization?: Authorization;
}): Authorization {
  if (!ctx.authorization) {
    throw new Error(
      "procedure reached a proof-bearing read without a .permission() mint",
    );
  }
  return ctx.authorization;
}

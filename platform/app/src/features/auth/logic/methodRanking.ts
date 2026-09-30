import type { SignInMethod } from "@langwatch/identity";

/**
 * The order the methods are drawn in (ADR-117, revision 2026-08-25).
 *
 * The server already ranks them strongest-first — passkey, then a federated
 * connection, then password — and that ranking is a security claim the browser
 * has no standing to make. What the browser knows that the server does not is
 * which method this PERSON last used here, and that is the one thing worth
 * promoting above it: somebody who signs in with the same method every day
 * should find it first, whatever the general ordering says.
 *
 * So it is one promotion and nothing else. The last-used method moves to the
 * front; everything below it keeps the server's order exactly. A full re-sort
 * on a local hint would let a browser's history quietly overrule a deployment's
 * ranking, and the hint is a convenience — it is absent on a new device, in a
 * private window, and in any browser that refuses site data.
 *
 * ── What changed, and why the old rule was right until now ──────────────
 *
 * This supersedes "badged, never reordered". That rule existed because the
 * list was the same for every address: reordering it by a local hint would
 * have made the SCREEN differ per browser while the decision behind it did
 * not, and a difference nobody can explain is a difference nobody can
 * support. Now the list is the account's own, so promoting the method that
 * account last used is the screen agreeing with itself rather than diverging
 * from the server.
 *
 * The badge stays where it was: it says which one, and now the order says it
 * too.
 */
export function rankMethodsForBrowser({
  methodSet,
  lastUsedMethodId,
}: {
  /** The server's ranking, already strongest-first. */
  methodSet: readonly SignInMethod[];
  /** The local hint, or null — which is the common case and fine. */
  lastUsedMethodId?: string | null;
}): readonly SignInMethod[] {
  if (!lastUsedMethodId) return methodSet;

  const lastUsed = methodSet.find((method) => method.id === lastUsedMethodId);
  // A hint naming a method this account does not hold — removed since, or
  // never held on this deployment — promotes nothing. It is a stale note, not
  // an instruction.
  if (!lastUsed) return methodSet;

  return [lastUsed, ...methodSet.filter((method) => method !== lastUsed)];
}

/**
 * Whether arriving on this screen should start a passkey ceremony.
 *
 * True only when the decision was made ABOUT an account — a picker keyed
 * `account_methods` — and that account holds a passkey. Everywhere else the
 * method set is the instance's, so a passkey in it means "this deployment
 * offers passkeys" rather than "you have one", and starting a ceremony on that
 * would prompt somebody who has never registered one.
 *
 * ── The gesture rule, and why this does not break it ────────────────────
 *
 * ADR-120's rule is that a passkey request needs a real gesture, and it was
 * written about the CONDITIONAL request — the invisible offer attached to an
 * address field, which a third-party provider answers with its own unlock
 * sheet the moment it starts. Nobody asked for that one, so nobody is owed a
 * prompt.
 *
 * Submitting an identifier is a gesture. It is a deliberate act with an
 * obvious next step, and the ceremony IS that next step; making the person
 * click a second button to reach it is the pattern every major provider has
 * already abandoned. The rule is intact and this is on the other side of it.
 */
export function shouldStartPasskeyOnArrival({
  reasonCode,
  methodSet,
  alreadyTried,
}: {
  reasonCode: string;
  methodSet: readonly SignInMethod[];
  /** A ceremony already run on this screen — failed, cancelled or otherwise.
   *  One automatic attempt, ever: a second would be the screen insisting. */
  alreadyTried: boolean;
}): boolean {
  if (alreadyTried) return false;
  if (reasonCode !== "account_methods") return false;
  return methodSet.some((method) => method.kind === "passkey");
}

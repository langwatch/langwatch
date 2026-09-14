import {
  AUTH0_SOCIAL_STRATEGIES,
  auth0SocialStrategyOfSubject,
} from "@langwatch/identity";

/**
 * The Auth0 connection bridge (D09, deliberately short-term): the branded
 * buttons SaaS shows while its social sign-ins still broker through Auth0.
 *
 * Each entry is a method id the sign-in surfaces offer as its own button —
 * "Continue with Google" — that DIALS the plain `auth0` provider with the
 * `connection` parameter Auth0's own screen would have set when that button
 * was clicked there. Auth0 skips its Universal Login and goes straight to
 * the upstream, so the person picks their provider exactly once, on our
 * screen. No second better-auth provider exists behind these ids: the dial
 * plan below maps them back to `auth0` at the moment of the call, the
 * callback and the account rows are exactly the ones the generic button
 * uses, and tearing the bridge down (D10) deletes ids, never accounts.
 *
 * The strategy vocabulary — which upstreams exist behind the broker, and
 * what each is called — is `@langwatch/identity`'s ONE table
 * (`AUTH0_SOCIAL_STRATEGIES`); this module only projects it into buttons.
 * The connection Auth0 dials is the strategy's own default name, true only
 * of OUR tenant — which is why the bridge activates only on SaaS
 * (`auth0BridgeActive`) and every self-hosted Auth0 deployment keeps the
 * generic hand-off to Auth0's own screen. Enterprise strategies (`waad`,
 * `samlp`) are per-tenant-named and deliberately absent from the table.
 */

export interface Auth0BridgeMethod {
  /** The id the sign-in surfaces offer and dial. */
  methodId: string;
  /** The Auth0 connection the dial names — what Universal Login would have
   *  set when its own button for this provider was clicked. The strategy's
   *  default connection name, which is also the strategy itself. */
  connection: string;
}

export const AUTH0_BRIDGE_METHODS: readonly Auth0BridgeMethod[] =
  AUTH0_SOCIAL_STRATEGIES.map((row) => ({
    methodId: `auth0-${row.nativeProviderId}`,
    connection: row.strategy,
  }));

/** Whether this deployment offers the bridge at all. */
export function auth0BridgeActive({
  isSaas,
  authProvider,
}: {
  isSaas: boolean;
  authProvider: string;
}): boolean {
  return isSaas && authProvider === "auth0";
}

/** The Auth0 connection a bridge method dials, or null for every other id. */
export function auth0BridgeConnectionOf(methodId: string): string | null {
  return (
    AUTH0_BRIDGE_METHODS.find((method) => method.methodId === methodId)
      ?.connection ?? null
  );
}

/**
 * The bridge method a stored Auth0 subject belongs to, or null where none
 * does — the broker's own database users (`auth0|`), enterprise connections
 * (`samlp|`, `waad|`), and a bare strategy with no subject behind it. Null
 * keeps the plain `auth0` method, which is a real answer: those sign-ins
 * belong on Auth0's own screen.
 */
export function auth0BridgeMethodForSubject(subject: string): string | null {
  const row = auth0SocialStrategyOfSubject(subject);
  if (row === null) return null;
  return `auth0-${row.nativeProviderId}`;
}

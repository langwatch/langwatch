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
 *
 * The bridge is also how the bridge ENDS, one provider at a time: mounting a
 * native client for a bridged provider replaces that button in place
 * (`auth0BridgeRailIds`) and re-routes its brokered accounts to the native
 * method (`auth0BridgeMethodForSubject`). Credential presence is the
 * activation switch — `@ee/sso/providers` already states that the
 * credentials ARE the operator's intent — so cutting one provider over is an
 * environment change, with no flag beside it to disagree.
 */

export interface Auth0BridgeMethod {
  /** The id the sign-in surfaces offer and dial. */
  methodId: string;
  /** The Auth0 connection the dial names — what Universal Login would have
   *  set when its own button for this provider was clicked. The strategy's
   *  default connection name, which is also the strategy itself. */
  connection: string;
  /** The method id of the SAME provider once the deployment mounts it
   *  natively — what this button becomes at activation. */
  nativeMethodId: string;
}

/** The product method id a native provider is dialed under. better-auth
 *  registers Microsoft as `microsoft`; everything outside it — the env, the
 *  `Account` rows, the callback path, the labels — says `azure-ad`, and
 *  `auth-client` maps one to the other at the moment of the dial. */
const nativeMethodIdOf = (nativeProviderId: string): string =>
  nativeProviderId === "microsoft" ? "azure-ad" : nativeProviderId;

export const AUTH0_BRIDGE_METHODS: readonly Auth0BridgeMethod[] =
  AUTH0_SOCIAL_STRATEGIES.map((row) => ({
    methodId: `auth0-${row.nativeProviderId}`,
    connection: row.strategy,
    nativeMethodId: nativeMethodIdOf(row.nativeProviderId),
  }));

/**
 * The method ids the bridge contributes to the sign-in rail, in rail order —
 * with a provider the deployment mounts NATIVELY standing in its bridge
 * slot. The moment the native client is mounted its bridge button steps
 * aside, in place: the rail never draws two Google buttons, and the leading
 * position never moves under the person reaching for it.
 */
export function auth0BridgeRailIds({
  mountedSocialMethodIds,
}: {
  mountedSocialMethodIds: readonly string[];
}): readonly string[] {
  return AUTH0_BRIDGE_METHODS.map((method) =>
    mountedSocialMethodIds.includes(method.nativeMethodId)
      ? method.nativeMethodId
      : method.methodId,
  );
}

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
 * The method a stored Auth0 subject belongs to, or null where none does — the
 * broker's own database users (`auth0|`), enterprise connections (`samlp|`,
 * `waad|`), and a bare strategy with no subject behind it. Null keeps the
 * plain `auth0` method, which is a real answer: those sign-ins belong on
 * Auth0's own screen.
 *
 * It answers the NATIVE method for a provider this deployment has mounted,
 * which is the cutover itself and has to move with the rail: ranking
 * intersects an account's methods with the offered set
 * (`rankAccountMethods`), so a brokered Google account still answered
 * `auth0-google` after the native button replaced that slot would match
 * nothing and land on the generic picker — the one screen it was routed
 * through this module to avoid. Answering `google` sends them to Google's own
 * screen in one step, and the callback resolves them through the identifier
 * the backfill derived from this very subject (`upstreamOfAuth0Subject`).
 */
export function auth0BridgeMethodForSubject({
  subject,
  mountedSocialMethodIds = [],
}: {
  subject: string;
  mountedSocialMethodIds?: readonly string[];
}): string | null {
  const row = auth0SocialStrategyOfSubject(subject);
  if (row === null) return null;
  const nativeMethodId = nativeMethodIdOf(row.nativeProviderId);
  return mountedSocialMethodIds.includes(nativeMethodId)
    ? nativeMethodId
    : `auth0-${row.nativeProviderId}`;
}

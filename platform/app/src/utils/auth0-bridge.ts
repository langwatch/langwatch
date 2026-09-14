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
 * HARDCODED ON PURPOSE. The connection names are Auth0 strategy defaults
 * (`google-oauth2`, `github`, `windowslive`) and true only of OUR tenant; a
 * self-hosted deployment's Auth0 carries connections we cannot name, which
 * is why the bridge activates only on SaaS (`auth0BridgeActive`) and
 * everyone else keeps the generic hand-off to Auth0's own screen. `waad`
 * (enterprise Azure AD) is deliberately absent even on SaaS: those
 * connections are named per tenant, and guessing sends someone to the wrong
 * organization's door.
 *
 * Framework-free on purpose: the sign-in policy (server) offers these ids,
 * the account lookup (server) maps stored Auth0 subjects onto them, and the
 * auth client (browser) dials them — one table, three readers.
 */

export interface Auth0BridgeMethod {
  /** The id the sign-in surfaces offer and dial. */
  methodId: string;
  /** The Auth0 connection the dial names — what Universal Login would have
   *  set when its own button for this provider was clicked. */
  connection: string;
  /** The strategy prefix Auth0 subjects for this connection carry, pipe
   *  included, so a stored account can be routed to its own button. */
  subjectPrefix: string;
}

export const AUTH0_BRIDGE_METHODS: readonly Auth0BridgeMethod[] = [
  {
    methodId: "auth0-google",
    connection: "google-oauth2",
    subjectPrefix: "google-oauth2|",
  },
  { methodId: "auth0-github", connection: "github", subjectPrefix: "github|" },
  {
    methodId: "auth0-microsoft",
    connection: "windowslive",
    subjectPrefix: "windowslive|",
  },
];

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
 * The bridge method an Auth0 subject belongs to, or null where none does —
 * the broker's own database users (`auth0|`), enterprise connections
 * (`samlp|`, `waad|`), and anything the bridge does not name. Null keeps the
 * plain `auth0` method, which is a real answer: those sign-ins belong on
 * Auth0's own screen.
 */
export function auth0BridgeMethodForSubject(subject: string): string | null {
  return (
    AUTH0_BRIDGE_METHODS.find((method) =>
      subject.startsWith(method.subjectPrefix),
    )?.methodId ?? null
  );
}

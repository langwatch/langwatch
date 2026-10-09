/**
 * Where a SAML sign-in the identity provider started lands: a target the
 * connection lists, matched exactly and never decoded, or the default home.
 * specs/identity/sso-saml-idp-initiated.feature
 */

const MAX_TARGET_LENGTH = 2048;
/** One leading slash, then unreserved, sub-delim, ":", "@", "/" or "?" only: no "%", "\", "#". */
const LANDING_PATH = /^\/(?!\/)[\w\-.~!$&'()*+,;=:@/?]*$/;

/** Whether an administrator may list this as a landing page: a path on LangWatch itself. */
export function isAllowableLandingTarget(target: string): boolean {
  return target.length <= MAX_TARGET_LENGTH && LANDING_PATH.test(target);
}

/** The listed target the RelayState names, or `defaultTarget` for anything else. */
export function idpInitiatedLanding({
  relayState,
  allowedTargets,
  appOrigin,
  defaultTarget,
}: {
  relayState: string | undefined;
  allowedTargets: readonly string[];
  appOrigin: string;
  defaultTarget: string;
}): string {
  const named = relayState === undefined ? "" : ownOriginPath({ relayState, appOrigin });
  return isAllowableLandingTarget(named) && allowedTargets.includes(named) ? named : defaultTarget;
}

/** A full address on our own origin as its path and query; anything else as sent. */
function ownOriginPath({
  relayState,
  appOrigin,
}: {
  relayState: string;
  appOrigin: string;
}): string {
  if (relayState.startsWith("/") || !URL.canParse(relayState)) return relayState;
  const url = new URL(relayState);
  const own =
    url.origin === new URL(appOrigin).origin && url.username === "" && url.password === "";
  return own ? url.pathname + url.search : relayState;
}

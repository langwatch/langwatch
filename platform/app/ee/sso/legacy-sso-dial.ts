// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The broker every existing enterprise customer arrives through. Behind it an
 * account's `providerId` is always `auth0` and the upstream it came from is in
 * the subject (`waad|acme-connection|user-123`), which is why a pin naming the
 * upstream is a pin only the broker can satisfy.
 */
const BROKER_METHOD_ID = "auth0";

/**
 * Which method this deployment MOUNTS carries an organization's legacy SSO pin
 * — or null when nothing here does.
 *
 * `Organization.ssoProvider` is not a mounted provider id and never was. It is
 * a provider NAME or a `providerAccountId` prefix naming the upstream behind a
 * broker (`isSsoProviderMatch` in `matching.ts` is the whole of what it means),
 * so comparing it to the mounted id by equality reads every brokered
 * enterprise organization as a provider this deployment does not have. They all
 * signed in through the broker before the identifier-first screen and they all
 * still can; the pin simply does not name the door.
 *
 * So the pin is read as what it is. A pin that IS the mounted id names that
 * method. A pin that is anything else, on a deployment mounting the broker,
 * names an upstream reachable only through the broker — the typed address
 * rides along as a login hint and the broker's own home-realm discovery takes
 * it from there. A pin that is anything else on a deployment mounting anything
 * else is a genuine disagreement: the organization names a provider nobody
 * here can dial, and routing must say so rather than send somebody to a door
 * that cannot open.
 *
 * This decides only whether there is a door, never who is let through it. The
 * callback still holds the pin against the arriving account
 * (`isSsoProviderMatch`), so somebody coming back from the wrong upstream is
 * refused there exactly as before.
 */
export function legacySsoDialOf({
  pin,
  mountedMethodId,
}: {
  pin: string;
  mountedMethodId: string | null;
}): string | null {
  if (mountedMethodId === null || pin === "") return null;
  if (pin === mountedMethodId) return mountedMethodId;
  return mountedMethodId === BROKER_METHOD_ID ? BROKER_METHOD_ID : null;
}

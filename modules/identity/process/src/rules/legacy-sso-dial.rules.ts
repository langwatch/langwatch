/** The broker existing enterprise customers arrive through: behind it a
 *  `providerId` is always `auth0` and the upstream is in the subject
 *  (`waad|acme-connection|user-123`), so a pin naming one is only its. */
const BROKER_METHOD_ID = "auth0";

/** Whether a pin has a door here, and which method it is. */
export type LegacySsoDial =
  | Readonly<{ dialable: true; methodId: string }>
  | Readonly<{ dialable: false }>;

const NOT_DIALABLE: LegacySsoDial = { dialable: false };

/**
 * Which mounted method carries an organization's legacy pin. `ssoProvider` is
 * a provider NAME or a subject prefix naming an upstream behind a broker,
 * never a mounted id: equality read every brokered organization as absent.
 */
export function legacySsoDialOf({
  pin,
  mountedMethodId,
}: {
  pin: string;
  mountedMethodId: string | null;
}): LegacySsoDial {
  if (mountedMethodId === null || pin === "") return NOT_DIALABLE;
  if (pin === mountedMethodId) return { dialable: true, methodId: mountedMethodId };

  // A pin that is anything else, on a deployment mounting the broker, names an
  // upstream reachable only through it: the typed address rides along as a
  // login hint and home-realm discovery takes it from there. Anywhere else it
  // is a genuine disagreement, and routing must say so.
  return mountedMethodId === BROKER_METHOD_ID
    ? { dialable: true, methodId: BROKER_METHOD_ID }
    : NOT_DIALABLE;
}

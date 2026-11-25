/**
 * The one reading of a private route's URL: provisioning and the routed executor must agree on
 * the server and database an organisation's reader is created in and signs in to.
 * @see specs/lwql/api.feature
 */
import { RESERVED_DATABASES } from "./langwatch-ql-policy.rules.ts";

/** A server as origin plus database: userinfo, query, host case and a default port are gone. */
export interface LwqlServerAddress {
  readonly origin: string;
  readonly database: string;
}

export type LwqlPrivateRouteRead =
  | { readonly route: LwqlServerAddress }
  | { readonly refusal: string };

/** Written unquoted into generated SQL, so only a lower-case identifier is a database name. */
const PLAIN_DATABASE_NAME = /^[a-z_][a-z0-9_]*$/;

export type LwqlServerAddressRead =
  | { readonly address: LwqlServerAddress }
  | { readonly unreadable: true };

/** Origin and decoded database of an http or https URL; never the caught error. */
export function readServerAddress({ url }: { url: string }): LwqlServerAddressRead {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { unreadable: true };
    return {
      address: {
        origin: parsed.origin,
        database: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
      },
    };
  } catch {
    return { unreadable: true };
  }
}

/**
 * The route's server and database, or a fixed refusal reason that carries none of the URL: a bad
 * scheme, no database (never the shared deployment's), a non-identifier or a reserved name.
 */
export function readPrivateRoute({ url }: { url: string }): LwqlPrivateRouteRead {
  const read = readServerAddress({ url });
  if ("unreadable" in read) {
    const scheme = URL.canParse(url) ? new URL(url).protocol : "";
    const isWeb = scheme === "http:" || scheme === "https:";
    return { refusal: scheme === "" || isWeb ? "unparsable route URL" : "bad scheme" };
  }
  const { address } = read;
  if (address.database === "") return { refusal: "no database" };
  if (!PLAIN_DATABASE_NAME.test(address.database)) return { refusal: "bad name shape" };
  if (RESERVED_DATABASES.includes(address.database)) return { refusal: "reserved database" };
  return { route: address };
}

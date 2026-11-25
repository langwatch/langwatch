/**
 * The read-only login an organisation's own ClickHouse gets for LangWatchQL, derived from the key
 * pepper and the organisation id: provisioning creates it and the routed executor signs in as it,
 * so neither ever uses the route URL's own login, and no two organisations share one.
 * @see specs/lwql/api.feature
 */
import { createHash } from "node:crypto";

import { derive } from "./lwql-default-credentials.rules.ts";

/** What a private reader's password is derived under; changing it rotates every reader. */
const PRIVATE_READER_LABEL = "langwatch:lwql:private-reader-password:v1";

/** Hex characters of the organisation id's digest in the login name: 48 bits, lower-case. */
const NAME_DIGEST_LENGTH = 12;

export interface LwqlPrivateReader {
  readonly username: string;
  readonly settingsProfile: string;
  readonly password: string;
}

/** Derives an organisation's private reader; the executor holds none where no key pepper is set. */
export type LwqlPrivateReaderOf = (input: { organizationId: string }) => LwqlPrivateReader;

/** Every derived reader starts with this; the shared reader, `langwatch_lwql`, does not. */
export const LWQL_PRIVATE_READER_PREFIX = "langwatch_lwql_";

/** `langwatch_lwql_<12 hex of the organisation id's sha256>`: a plain, lower-case identifier. */
export function privateReaderOf({
  keyPepper,
  organizationId,
}: {
  keyPepper: string;
  organizationId: string;
}): LwqlPrivateReader {
  const digest = createHash("sha256").update(organizationId).digest("hex");
  const username = `${LWQL_PRIVATE_READER_PREFIX}${digest.slice(0, NAME_DIGEST_LENGTH)}`;
  return {
    username,
    settingsProfile: `${username}_profile`,
    password: derive({ keyPepper, label: `${PRIVATE_READER_LABEL}:${organizationId}` }),
  };
}

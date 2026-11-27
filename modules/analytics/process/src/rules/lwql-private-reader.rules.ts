/**
 * The read-only login an organisation's own ClickHouse gets for LangWatchQL: its name from the
 * organisation id, its password the instance's own or, where none is set, derived from the key
 * pepper. Provisioning creates it and the routed executor signs in as it (ADR-200).
 * @see specs/lwql/api.feature
 */
import { createHash } from "node:crypto";

import { privateRouteNameOf } from "@langwatch/process-stores";

import {
  derive,
  LWQL_PRIVATE_READER_PASSWORD_ENV_PREFIX,
} from "./lwql-default-credentials.rules.ts";

/** What a private reader's password is derived under; changing it rotates every reader. */
const PRIVATE_READER_LABEL = "langwatch:lwql:private-reader-password:v1";

/** Hex characters of the organisation id's digest in the login name: 48 bits, lower-case. */
const NAME_DIGEST_LENGTH = 12;

/** A password shorter than this, once trimmed, is refused: too guessable for a reader's login. */
export const LWQL_PRIVATE_READER_PASSWORD_MIN_LENGTH = 32;

/** A private reader's login and settings profile, which never depend on its password. */
export interface LwqlPrivateReaderName {
  readonly username: string;
  readonly settingsProfile: string;
}

export interface LwqlPrivateReader extends LwqlPrivateReaderName {
  readonly password: string;
}

/** An organisation's private reader, or null where it can have none, so its runs refuse. */
export type LwqlPrivateReaderOf = (input: { organizationId: string }) => LwqlPrivateReader | null;

/** Every derived reader starts with this; the shared reader, `langwatch_lwql`, does not. */
export const LWQL_PRIVATE_READER_PREFIX = "langwatch_lwql_";

/** `langwatch_lwql_<12 hex of the organisation id's sha256>`: a plain, lower-case identifier. */
export function privateReaderNameOf({
  organizationId,
}: {
  organizationId: string;
}): LwqlPrivateReaderName {
  const digest = createHash("sha256").update(organizationId).digest("hex");
  const username = `${LWQL_PRIVATE_READER_PREFIX}${digest.slice(0, NAME_DIGEST_LENGTH)}`;
  return { username, settingsProfile: `${username}_profile` };
}

/** The reader with the instance's own password where given, else the key pepper's HMAC. */
export function privateReaderOf(
  input: { organizationId: string } & (
    | { password: string; keyPepper?: string | undefined }
    | { password?: undefined; keyPepper: string }
  ),
): LwqlPrivateReader {
  const { organizationId } = input;
  return {
    ...privateReaderNameOf({ organizationId }),
    password:
      input.password === undefined
        ? derive({ keyPepper: input.keyPepper, label: `${PRIVATE_READER_LABEL}:${organizationId}` })
        : input.password,
  };
}

/** Each organisation's own reader password, and the variable refused for one, by name only. */
export interface LwqlPrivateReaderPasswords {
  readonly passwords: ReadonlyMap<string, string>;
  /** Blank, short, shared with another organisation, or the second naming one: never a fallback. */
  readonly refused: ReadonlyMap<string, string>;
}

interface ReaderPasswordEntry {
  readonly organizationId: string;
  readonly variable: string;
  readonly value: string;
}

/** The family's entries naming an organisation; an id starting `_` is a mistyped separator. */
function readerPasswordEntriesOf(
  source: Readonly<Record<string, string | undefined>>,
): ReaderPasswordEntry[] {
  return Object.entries(source).flatMap(([variable, value]) => {
    if (!variable.startsWith(LWQL_PRIVATE_READER_PASSWORD_ENV_PREFIX) || value === undefined) {
      return [];
    }
    const { organizationId } = privateRouteNameOf({
      prefix: LWQL_PRIVATE_READER_PASSWORD_ENV_PREFIX,
      variable,
    });
    if (organizationId === "" || organizationId.startsWith("_")) return [];
    return [{ organizationId, variable, value }];
  });
}

/** A value two organisations share is one secret for two servers: every holder is refused. */
function refuseShared({
  accepted,
  refused,
}: {
  accepted: Map<string, ReaderPasswordEntry>;
  refused: Map<string, string>;
}): void {
  const holders = new Map<string, ReaderPasswordEntry[]>();
  for (const entry of accepted.values()) {
    holders.set(entry.value, [...(holders.get(entry.value) ?? []), entry]);
  }
  for (const shared of holders.values()) {
    if (shared.length < 2) continue;
    for (const { organizationId, variable } of shared) {
      accepted.delete(organizationId);
      refused.set(organizationId, variable);
    }
  }
}

/** Pure and total: the label is for humans; the organisation follows the last `__`. */
export function parsePrivateReaderPasswords(
  source: Readonly<Record<string, string | undefined>>,
): LwqlPrivateReaderPasswords {
  const accepted = new Map<string, ReaderPasswordEntry>();
  const refused = new Map<string, string>();
  for (const entry of readerPasswordEntriesOf(source)) {
    const { organizationId, variable, value } = entry;
    // Short, or a second one for the organisation: using either would be a guess, so refuse.
    const doubled = accepted.has(organizationId) || refused.has(organizationId);
    if (doubled || value.trim().length < LWQL_PRIVATE_READER_PASSWORD_MIN_LENGTH) {
      accepted.delete(organizationId);
      refused.set(organizationId, variable);
    } else {
      accepted.set(organizationId, entry);
    }
  }
  refuseShared({ accepted, refused });
  const passwords = new Map(
    [...accepted].map(([organizationId, { value }]) => [organizationId, value]),
  );
  return { passwords, refused };
}

/** How an organisation's reader was found: its own password, derived, refused or absent. */
export type LwqlPrivateReaderResolution =
  | { readonly kind: "own"; readonly reader: LwqlPrivateReader }
  | { readonly kind: "derived"; readonly reader: LwqlPrivateReader }
  | { readonly kind: "refused"; readonly variable: string }
  | { readonly kind: "absent" };

/** The own password wins; the key pepper stands in only where none is set, never for a refusal. */
export function resolvePrivateReader({
  organizationId,
  passwords,
  keyPepper,
}: {
  organizationId: string;
  passwords: LwqlPrivateReaderPasswords;
  keyPepper: string | undefined;
}): LwqlPrivateReaderResolution {
  const variable = passwords.refused.get(organizationId);
  if (variable !== undefined) return { kind: "refused", variable };
  const password = passwords.passwords.get(organizationId);
  if (password !== undefined) {
    return { kind: "own", reader: privateReaderOf({ organizationId, password }) };
  }
  if (keyPepper === undefined || keyPepper === "") return { kind: "absent" };
  return { kind: "derived", reader: privateReaderOf({ organizationId, keyPepper }) };
}

/** A resolution that is not the organisation's own password: derived, refused or absent. */
export type LwqlPrivateReaderFallback = Exclude<LwqlPrivateReaderResolution, { kind: "own" }>;

/** The query path's lookup: null for an organisation without a reader; each fallback told once. */
export function privateReaderLookupOf({
  passwords,
  keyPepper,
  onFallback,
}: {
  passwords: LwqlPrivateReaderPasswords;
  keyPepper: string | undefined;
  onFallback: (input: { organizationId: string; fallback: LwqlPrivateReaderFallback }) => void;
}): LwqlPrivateReaderOf {
  const told = new Set<string>();
  return ({ organizationId }) => {
    const resolved = resolvePrivateReader({ organizationId, passwords, keyPepper });
    if (resolved.kind === "own") return resolved.reader;
    if (!told.has(organizationId)) {
      told.add(organizationId);
      onFallback({ organizationId, fallback: resolved });
    }
    return resolved.kind === "derived" ? resolved.reader : null;
  };
}

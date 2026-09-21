import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity-contract";

import type { SsoConnectionHistoryEntry } from "../repositories/sso-connection-history.repository.ts";

/**
 * The words a reader reads about one line of a connection's history (ADR-117
 * §5, D05). Pure, and the only place a `type` becomes a sentence.
 */

/**
 * What proved, or is proving, a domain in the customer's own words. The one
 * method that is NOT the customer's own proof — `operator-attested` — never
 * reaches this map, so a future edit here cannot word the two the same way.
 */
function selfProvedMethodWords(method: string | null): string {
  switch (method) {
    case "dns-txt":
      return "a DNS record";
    case "https-file":
      return "a file published on the domain";
    case "license-token":
      return "your installation's licence";
    case "legacy-configuration":
      return "your existing configuration";
    default:
      return "the evidence given";
  }
}

/** What each sentence below reads off one entry, destructured once. */
type HistoryCopyFields = Pick<
  SsoConnectionHistoryEntry,
  "domain" | "method" | "route" | "policy" | "note" | "name"
>;

function forDomain(domain: string | null): string {
  return domain ? ` for ${domain}` : "";
}

function withNote(note: string | null): string {
  return note ? `: ${note}` : "";
}

/**
 * One sentence per event type, as a lookup rather than one long `switch`:
 * each entry is independent, and a new fact cannot land without its words
 * because this record is exhaustive over the event union.
 */
const HISTORY_COPY_BY_EVENT_TYPE: Record<
  SsoConnectionHistoryEntry["type"],
  (fields: HistoryCopyFields) => string
> = {
  [CONNECTION_REGISTERED_EVENT_TYPE]: () => "The connection was registered",
  [DOMAIN_CLAIMED_EVENT_TYPE]: ({ domain }) => `${domain ?? "A domain"} was claimed`,
  [DOMAIN_CLAIM_APPROVED_EVENT_TYPE]: ({ domain }) => `The claim${forDomain(domain)} was approved`,
  [DOMAIN_CLAIM_REJECTED_EVENT_TYPE]: ({ domain, note }) =>
    `The claim${forDomain(domain)} was declined${withNote(note)}`,
  [CONNECTION_DISCARDED_EVENT_TYPE]: () => "The connection was removed before it went live",
  [VERIFICATION_REQUESTED_EVENT_TYPE]: ({ domain, method }) =>
    `Verification began${forDomain(domain)}, using ${selfProvedMethodWords(method)}`,
  // Never described as the customer's own proof (D05 amendment) — always
  // names the operator outright, whatever `method` carries.
  [DOMAIN_ATTESTED_EVENT_TYPE]: ({ domain, note }) =>
    `${domain ?? "The domain"} was verified by a LangWatch operator${
      note ? `, noting: ${note}` : ""
    }`,
  [DOMAIN_VERIFIED_EVENT_TYPE]: ({ domain, method }) =>
    `${domain ?? "A domain"} was verified using ${selfProvedMethodWords(method)}`,
  [CONNECTION_ACTIVATED_EVENT_TYPE]: () => "The connection was turned on",
  [CONNECTION_SUSPENDED_EVENT_TYPE]: ({ note }) => `The connection was suspended${withNote(note)}`,
  [CONNECTION_RESUMED_EVENT_TYPE]: () => "The connection was resumed",
  [TEARDOWN_REQUESTED_EVENT_TYPE]: ({ note }) => `Removal was requested${withNote(note)}`,
  [CONNECTION_TORN_DOWN_EVENT_TYPE]: () => "The connection was removed",
};

/**
 * One history entry, as a sentence. Structural fields in, prose out — the
 * repository never hands a raw payload through, and no internal name or wire
 * type ever reaches the reader.
 */
export function ssoConnectionHistoryCopy(
  entry: Pick<
    SsoConnectionHistoryEntry,
    "type" | "domain" | "method" | "route" | "policy" | "note" | "name"
  >,
): string {
  const copy = HISTORY_COPY_BY_EVENT_TYPE[entry.type];
  // A fact with no words is still a fact, and dropping it would make the
  // sequence lie about what happened: it says the least that is true.
  if (!copy) return "Something happened to this connection that we have no words for yet";
  return copy(entry);
}

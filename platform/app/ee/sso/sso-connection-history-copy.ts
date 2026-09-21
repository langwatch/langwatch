// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The words a customer or an operator reads about one line of a connection's
 * history (ADR-117 SS5, D04).
 *
 * A pure module with no reads and no framework, for the reason the error
 * presentation registry and the directory activity copy
 * (`scim-reconciliation-copy.ts`) both are one: what a reader reads is a
 * decision, and a decision spread across a page component and a service is a
 * decision two people will make differently.
 *
 * Two rules the D05 amendment is explicit about, and this file is where they
 * hold:
 *
 *   AN ATTESTED DOMAIN NEVER READS AS THE CUSTOMER'S OWN PROOF. The words for
 *   `domain_attested` name a LangWatch operator outright - see
 *   specs/identity/sso-connection-lifecycle.feature, "How a domain was
 *   proved is its own recorded method, permanently".
 *
 *   NO INTERNAL NAME OR EVENT TYPE REACHES THE READER. `lw.identity.
 *   connection_activated` is a wire type, not a sentence; every entry reads
 *   as prose a customer or an operator can act on.
 */

import {
  arrivalAnswerLabel,
  SSO_ANSWER_BY_POLICY,
} from "@ee/sso/logic/arrivals";
import type { SsoConnectionHistoryEntry } from "@ee/sso/sso-connection-event-log.repository";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RENAMED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  MIGRATION_FINALIZED_EVENT_TYPE,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  type SsoArrivalPolicy,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity";

/**
 * What proved (or is proving) a domain, in the customer's own words. The one
 * method that is not the customer's own proof - `operator-attested` - is
 * handled by its own callers rather than through this map, so the two can
 * never be worded the same way by a future edit here.
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

/** The arrival policy's words, as the rest of the product already says them
 *  (`@ee/sso/logic/arrivals`) - reused rather than restated, so this
 *  line and the setup journey's own summary cannot describe the same answer
 *  two different ways. */
function arrivalPolicyWords(policy: string | null): string {
  const known = (Object.keys(SSO_ANSWER_BY_POLICY) as SsoArrivalPolicy[]).find(
    (candidate) => candidate === policy,
  );
  if (!known) return "who this connection admits";
  return arrivalAnswerLabel(SSO_ANSWER_BY_POLICY[known]).toLowerCase();
}

/** What `ssoConnectionHistoryCopy` reads off one entry — one destructure
 *  shared by every sentence below, rather than a parameter list each has to
 *  repeat. */
type HistoryCopyFields = Pick<
  SsoConnectionHistoryEntry,
  "domain" | "method" | "route" | "policy" | "note" | "name"
>;

/**
 * One sentence per event type, as a lookup rather than a long `switch` — each
 * entry is independent, so the file's complexity is one small function per
 * fact instead of one large function branching on all of them.
 */
const HISTORY_COPY_BY_EVENT_TYPE: Record<
  SsoConnectionHistoryEntry["type"],
  (fields: HistoryCopyFields) => string
> = {
  [CONNECTION_REGISTERED_EVENT_TYPE]: () => "The connection was registered",
  [REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE]: () =>
    "A replacement connection was registered",
  [MIGRATION_ROUTE_SELECTED_EVENT_TYPE]: ({ route }) =>
    route === "direct"
      ? "Normal sign-in was moved to the replacement connection"
      : "Normal sign-in was moved back to the earlier connection",
  [MIGRATION_FINALIZATION_STARTED_EVENT_TYPE]: () =>
    "Finalizing the migration began",
  [MIGRATION_FINALIZED_EVENT_TYPE]: () => "The migration was finalized",
  [DOMAIN_CLAIMED_EVENT_TYPE]: ({ domain }) =>
    `${domain ?? "A domain"} was claimed`,
  [DOMAIN_CLAIM_APPROVED_EVENT_TYPE]: ({ domain }) =>
    `The claim${forDomain(domain)} was approved`,
  [DOMAIN_CLAIM_REJECTED_EVENT_TYPE]: ({ domain, note }) =>
    `The claim${forDomain(domain)} was declined${withNote(note)}`,
  [CONNECTION_DISCARDED_EVENT_TYPE]: () =>
    "The connection was removed before it went live",
  [VERIFICATION_REQUESTED_EVENT_TYPE]: ({ domain, method }) =>
    `Verification began${forDomain(domain)}, using ${selfProvedMethodWords(method)}`,
  // Never described as the customer's own proof (D05 amendment) - always
  // names the operator outright, whatever `method` carries.
  [DOMAIN_ATTESTED_EVENT_TYPE]: ({ domain, note }) =>
    `${domain ?? "The domain"} was verified by a LangWatch operator${
      note ? `, noting: ${note}` : ""
    }`,
  [DOMAIN_WITHDRAWN_EVENT_TYPE]: ({ domain }) =>
    `${domain ?? "A domain"} was removed from the connection`,
  [DOMAIN_VERIFIED_EVENT_TYPE]: ({ domain, method }) =>
    `${domain ?? "A domain"} was verified using ${selfProvedMethodWords(method)}`,
  [DOMAIN_PROOF_WAVERED_EVENT_TYPE]: ({ domain }) =>
    `The published record${forDomain(domain)} could not be found`,
  [DOMAIN_PROOF_LAPSED_EVENT_TYPE]: ({ domain }) =>
    `${domain ?? "The domain"} stopped counting toward automatic joining because its published record stayed missing`,
  [DOMAIN_PROOF_RECOVERED_EVENT_TYPE]: ({ domain }) =>
    `The published record${forDomain(domain)} was found again`,
  [CONNECTION_ACTIVATED_EVENT_TYPE]: () => "The connection was turned on",
  [CONNECTION_SUSPENDED_EVENT_TYPE]: ({ note }) =>
    `The connection was suspended${withNote(note)}`,
  [CONNECTION_RESUMED_EVENT_TYPE]: () => "The connection was resumed",
  [TEARDOWN_REQUESTED_EVENT_TYPE]: ({ note }) =>
    `Removal was requested${withNote(note)}`,
  [CONNECTION_TORN_DOWN_EVENT_TYPE]: () => "The connection was removed",
  [CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE]: ({ policy }) =>
    `Who this connection admits was set to "${arrivalPolicyWords(policy)}"`,
  // The new name and not the old one: the history is read top-down, so the
  // line above already says what it was called before.
  [CONNECTION_RENAMED_EVENT_TYPE]: ({ name }) =>
    `The connection was renamed to "${name}"`,
};

function forDomain(domain: string | null): string {
  return domain ? ` for ${domain}` : "";
}

function withNote(note: string | null): string {
  return note ? `: ${note}` : "";
}

/**
 * One history entry, as a sentence. Structural fields in, prose out - the
 * repository never hands a raw payload through, and this is the only place
 * that turns an event's `type` into words.
 */
export function ssoConnectionHistoryCopy(
  entry: Pick<
    SsoConnectionHistoryEntry,
    "type" | "domain" | "method" | "route" | "policy" | "note" | "name"
  >,
): string {
  const copy = HISTORY_COPY_BY_EVENT_TYPE[entry.type];
  if (!copy) {
    // A fact this surface has no words for is still a fact, and dropping it
    // would make the sequence lie about what happened - it says the least
    // that is true rather than nothing at all (the SCIM activity feed makes
    // the same choice for the same reason).
    return "Something happened to this connection that we have no words for yet";
  }
  return copy(entry);
}

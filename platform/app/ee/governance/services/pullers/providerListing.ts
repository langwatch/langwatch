// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a provider answered when it was asked to enumerate something.
 *
 * Pure. No I/O and no clock — the per-provider modules do the talking and hand
 * the reply here, the same way `microsoftGraphSeats.ts` sits beside its puller.
 *
 * THREE outcomes, not two, and that is the whole reason this type exists. A
 * scheduled pull reads a provider's list only to put a name on a row, so it
 * treats a refusal and an empty tenant identically: both mean "no names this
 * run", both are survivable. That is right for a pull and wrong for everything
 * else. An admin looking at a screen that says the tenant has no people needs
 * to know whether the provider said so or refused to answer, because one of
 * those is a fact about their tenant and the other is a fact about their
 * credential.
 *
 * A refusal is a VALUE rather than a throw. The callers that must degrade (a
 * pull path, a sweep over many sources) would otherwise have to catch, and a
 * catch is exactly what erased the distinction in the first place.
 *
 * GENERIC over the row, because agents and people differ only in what a row
 * holds. The three arms, the reason vocabulary and the status mapping below
 * are the same question asked of the same providers over the same transport,
 * and two copies of "what does a 403 mean" is how the two lists drift into
 * answering it differently.
 */

/**
 * Why a provider would not list. A code rather than prose, for two reasons: a
 * later job renders the copy, and upstream error bodies can carry credentials
 * and provider payloads, which is the same reason `failureMessage` in
 * `sourcePullStatus.ts` collapses them.
 */
export type ListingRefusalReason =
  /** The credential is not permitted to enumerate. 401 and 403. */
  | "unauthorized"
  /** The address named no such collection. 404. */
  | "not_found"
  /** 429. Asking again later is the action. */
  | "rate_limited"
  /** The provider answered, badly. 5xx and anything unmapped. */
  | "unavailable"
  /** Transport failed: DNS, TLS, timeout, abort. */
  | "unreachable"
  /** A 2xx that was not the documented shape. A proxy or a captive portal. */
  | "malformed_response"
  /** The source holds no credential this provider can sign in with. */
  | "not_configured"
  /**
   * The collection is longer than the walk will follow. The one member that
   * describes OUR side rather than the provider's.
   *
   * Every other reason here answers "what did the provider do". This one
   * answers "where did we stop", and it needs its own member because the
   * others cannot express it: each page was asked for and answered, correctly
   * and with a success status, and then a bound we chose ended the walk. It is
   * the same distinction `LISTING_FAILED_REASON` exists to keep — a reader who
   * cannot tell "your credential was rejected" from "we could not finish" gets
   * offered a fix for a problem they do not have.
   *
   * It also carries a different instruction. `unavailable` and `unreachable`
   * mean try again; this one is permanent until something changes, because the
   * next walk reads the same pages and stops in the same place.
   *
   * `status` is null against this reason even though answers did come back:
   * the field carries the status of a provider answer that FAILED, and here
   * none did.
   */
  | "too_many_pages"
  /**
   * The provider stopped advancing through a collection before the total it
   * had stated. The second member describing OUR reading rather than the
   * provider's answer, and it is a different stop from `too_many_pages`.
   *
   * `too_many_pages` is a bound WE chose: every page was served, and we
   * stopped asking. This one is the provider declining to move -- it serves a
   * page that names nobody, or re-serves rows already read, while claiming a
   * larger total. Each request was answered with a success status, so no
   * status-derived reason fits, and `malformed_response` would be wrong twice:
   * the page parsed, and its cause tells the reader to try again.
   *
   * Asking again does not help. The next walk sends the same pagination
   * parameters and is answered the same way, which is what makes this
   * incomplete rather than transient. Reporting it as a listing instead would
   * put a fraction of the directory on a screen as the whole of it, and every
   * retry would confirm the same wrong number.
   *
   * `status` is null against this reason: the field carries the status of a
   * provider answer that FAILED, and here every answer succeeded.
   */
  | "pagination_stalled";

export interface ListingRefusal {
  reason: ListingRefusalReason;
  /** The provider's HTTP status when there was one, for the log and the badge. */
  status: number | null;
}

/**
 * `listed` guarantees at least one row, `empty` guarantees none, and `refused`
 * carries no rows at all. A caller that wants the rows has to name the refusal
 * arm to get past it, which is the forcing function.
 */
export type ProviderListing<T> =
  | { outcome: "listed"; items: T[] }
  | { outcome: "empty"; items: [] }
  | { outcome: "refused"; refusal: ListingRefusal };

/** Picks the `listed`/`empty` arm from what the provider actually returned. */
export function itemsListed<T>(items: T[]): ProviderListing<T> {
  return items.length === 0
    ? { outcome: "empty", items: [] }
    : { outcome: "listed", items };
}

export function listingRefused<T>(refusal: ListingRefusal): ProviderListing<T> {
  return { outcome: "refused", refusal };
}

/**
 * An HTTP status turned into the reason a customer can act on.
 *
 * Anything unmapped falls to `unavailable` rather than to a reason of its own:
 * a status nobody anticipated is by definition a provider that did not answer
 * the way it documents, and "try again" is the only honest instruction. The
 * status rides along, so a log still says which one it was.
 */
export function refusalFromStatus(status: number): ListingRefusal {
  if (status === 401 || status === 403) {
    return { reason: "unauthorized", status };
  }
  if (status === 404) return { reason: "not_found", status };
  if (status === 429) return { reason: "rate_limited", status };
  return { reason: "unavailable", status };
}

/**
 * A thrown transport failure turned into a refusal.
 *
 * The error itself never travels. It is a `fetch` failure carrying a URL that
 * may hold a token in a query string, or a zod issue quoting the reply body,
 * and this value is destined for a screen.
 */
export function refusalFromThrown(error: unknown): ListingRefusal {
  const name = error instanceof Error ? error.name : "";
  // A zod parse failure on a 2xx body is the captive-portal case: the request
  // reached something, and that something is not the provider's documented API.
  if (name === "ZodError") {
    return { reason: "malformed_response", status: null };
  }
  return { reason: "unreachable", status: null };
}

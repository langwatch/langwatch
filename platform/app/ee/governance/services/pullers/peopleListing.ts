// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a provider answered when it was asked to list its people.
 *
 * The three outcomes, the refusal vocabulary and the status mapping come from
 * {@link ProviderListing}, shared with the agent listing. This file holds the
 * row and the one conversion that matters: a listed person becomes a DIRECTORY
 * event, in the same shape a pull produces, so the rows reach the person
 * tables down the path that already exists rather than beside it.
 *
 * Why an event and not a repository call. `PersonDiscoveryService` is fed the
 * KEPT half of the erasure partition, and that ordering is load-bearing: the
 * pullers re-read a lookback window, so any writer that skipped the check
 * would re-create a plaintext person row the day after every erasure. A
 * listing is exactly that kind of re-read, once a person presses the button.
 * Producing events means the listing passes the same check, keyed on the same
 * `actor` field, with no listing-specific carve-out to keep in step.
 *
 * A directory event and not an activity one, deliberately. Those dates mean
 * "was active", and a staff list is a statement about who exists. A person the
 * tenant employs but who has not touched a model this month must not read as
 * active today because an admin refreshed the list.
 */

import { DIRECTORY_REPORT_ACTION } from "./microsoftGraphDirectory";
import type { ListingRefusal, ProviderListing } from "./providerListing";
import { itemsListed, listingRefused } from "./providerListing";
import type { NormalizedPullEvent } from "./pullerAdapter";

export {
  type ListingRefusal as PeopleListingRefusal,
  type ListingRefusalReason as PeopleListingRefusalReason,
  refusalFromStatus,
  refusalFromThrown,
} from "./providerListing";

/**
 * One person a provider listed.
 *
 * `rawActorId` is the JOIN KEY, and picking it is the whole difficulty of this
 * feature. It has to be the identifier this provider's ACTIVITY rows already
 * carry, because `DiscoveredPerson` is keyed on it: choose differently and one
 * human becomes two rows, one with spend and no name and one with a name and
 * no spend. Each provider module picks it against its own puller's `actor`,
 * and says which in a comment.
 *
 * The other three fields are facts ABOUT that person. They never become the
 * key, and the address least of all: a tenant re-issues an address, and keying
 * on one would move a person's whole history the day they marry.
 */
export interface DiscoveredPersonRecord {
  /** The provider's own identifier for this person, verbatim. Never "". */
  rawActorId: string;
  /** The provider's own name for them, "" when it named none. */
  displayName: string;
  /** Their address, "" when the provider did not carry one. */
  email: string;
  /** The department the provider filed them under, "" when it named none. */
  department: string;
}

export type PeopleListing = ProviderListing<DiscoveredPersonRecord>;

/** Picks the `listed`/`empty` arm from what the provider actually returned. */
export function peopleListed(people: DiscoveredPersonRecord[]): PeopleListing {
  return itemsListed(people);
}

export function peopleRefused(refusal: ListingRefusal): PeopleListing {
  return listingRefused(refusal);
}

/** The UTC calendar day an instant falls in, `YYYY-MM-DD`. */
export function listingDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A listed staff list as the directory events the discovery path consumes.
 *
 * The identity is the person and the day, never the fields, matching the
 * directory events a pull already emits: two listings on one day land ON each
 * other instead of accumulating. Nothing here reaches ClickHouse — these
 * events go straight to `PersonDiscoveryService` — so `source_event_id` is a
 * stable name rather than an audit key, and the money fields are zero because
 * a staff list reports no spend.
 *
 * A record with no identifier is DROPPED rather than emitted with a blank
 * actor. Discovery skips a blank actor anyway, and a row that reached the
 * erasure check with an empty key would be a row the check cannot suppress.
 */
export function personListingEvents(params: {
  people: DiscoveredPersonRecord[];
  /** The source type, which is what the events are attributed to. */
  provider: string;
  /** The calendar day being reported on, `YYYY-MM-DD` in UTC. */
  day: string;
}): NormalizedPullEvent[] {
  const { people, provider, day } = params;

  return people
    .filter((person) => person.rawActorId !== "")
    .map((person) => ({
      source_event_id: `${provider}_directory:${person.rawActorId}:${day}`,
      // The day the listing belongs to, not the instant it was read, so a
      // second press of the button does not restate the same fact.
      event_timestamp: `${day}T00:00:00.000Z`,
      actor: person.rawActorId,
      action: DIRECTORY_REPORT_ACTION,
      target: person.department,
      cost_usd: "0",
      tokens_input: 0,
      tokens_output: 0,
      // The record, not the provider's reply. The reply body is the thing that
      // can carry a token or another tenant's row, and this string is stored.
      raw_payload: JSON.stringify(person),
      extra: {
        // The names `personDiscovery` reads, in the order it prefers them.
        displayName: person.displayName,
        mail: person.email,
        userPrincipalName: "",
        department: person.department,
      },
    }));
}

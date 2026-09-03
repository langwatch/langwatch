// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The feed that discovers people (ADR-128 §10–11).
 *
 * Every pulled row already names who did the thing; until this service,
 * those names were read for money and audit and then forgotten — nothing
 * wrote them down as people, the match engine swept an empty list, and the
 * People screen had nobody to show. This is the producer the engine spec
 * promised ("the trigger arrives with the feed that discovers people"),
 * minus the trigger, which stays a button a person presses.
 *
 * Fed exclusively with events that already passed the erasure suppression
 * check — the worker hands it the KEPT half of the partition. That ordering
 * is load-bearing: the pullers re-read a thirty-day window, so discovery
 * running before that check would re-create a plaintext person row the day
 * after every erasure.
 *
 * Two sighting kinds, deliberately unequal:
 *
 *  - an ACTIVITY row (a cost line, a query, a conversation) creates the
 *    person and widens their seen range — those dates mean "was active";
 *  - a DIRECTORY row creates the person and upgrades their display text,
 *    but never touches the seen range — a directory lists presence, and a
 *    person refreshed daily by it must not read as "active today".
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */

import type { PrismaClient } from "~/generated/prisma/client";

import {
  DISCOVERED_PERSON_KIND,
  DiscoveredPersonRepository,
} from "../repositories/governanceIdentity.repository";
import { DIRECTORY_REPORT_ACTION } from "./pullers/microsoftGraphDirectory";
import type { NormalizedPullEvent } from "./pullers/pullerAdapter";

/**
 * ADR-128 §10's deterministic service-account rule, and nothing looser: in
 * Databricks query history humans surface as emails and service principals
 * as bare UUIDs (proven under app-only auth). Provider-specific on purpose —
 * a directory id is UUID-shaped everywhere Microsoft touches, and those are
 * people.
 */
const DATABRICKS_PROVIDER = "databricks_genie";
const BARE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kindOf({
  provider,
  rawActorId,
}: {
  provider: string;
  rawActorId: string;
}): string {
  return provider === DATABRICKS_PROVIDER && BARE_UUID.test(rawActorId)
    ? DISCOVERED_PERSON_KIND.SERVICE_ACCOUNT
    : DISCOVERED_PERSON_KIND.PERSON;
}

/** A string field off an event's `extra`, or "" for anything else. */
function extraString(event: NormalizedPullEvent, field: string): string {
  const value = event.extra?.[field];
  return typeof value === "string" ? value : "";
}

export class PersonDiscoveryService {
  private readonly prisma: PrismaClient;
  private readonly people: DiscoveredPersonRepository;

  constructor({ prisma }: { prisma: PrismaClient }) {
    this.prisma = prisma;
    this.people = new DiscoveredPersonRepository();
  }

  static create(prisma: PrismaClient): PersonDiscoveryService {
    return new PersonDiscoveryService({ prisma });
  }

  /**
   * Records everyone a batch of pulled events names.
   *
   * One write per distinct actor, not per event: a batch is routinely
   * thousands of rows naming a handful of people, and the repository's
   * widen-only writes make replaying the same window a no-op.
   *
   * Rows naming nobody (`actor === ""`) discover nobody — seat reports
   * deliberately name no person, and inventing one would attribute the
   * tenant's procurement to a blank string.
   */
  async recordFromPulledEvents({
    organizationId,
    provider,
    events,
  }: {
    organizationId: string;
    /** The source type, which is what `DiscoveredPerson.provider` holds. */
    provider: string;
    events: NormalizedPullEvent[];
  }): Promise<{ discovered: number }> {
    const activityByActor = new Map<
      string,
      { earliestAt: Date; latestAt: Date }
    >();
    const directoryByActor = new Map<
      string,
      { displayText: string; seenAt: Date }
    >();

    for (const event of events) {
      if (event.actor === "") continue;
      const seenAt = new Date(event.event_timestamp);
      // An adapter that emitted an unparseable timestamp gets its event
      // recorded elsewhere; a seen-date of `Invalid Date` would poison the
      // widen comparisons for everyone sharing the row.
      if (Number.isNaN(seenAt.getTime())) continue;

      if (event.action === DIRECTORY_REPORT_ACTION) {
        // The best name the row offers, falling back to the address and
        // finally the id itself — a person must never render as "".
        const displayText =
          extraString(event, "displayName") ||
          extraString(event, "mail") ||
          extraString(event, "userPrincipalName") ||
          event.actor;
        directoryByActor.set(event.actor, { displayText, seenAt });
        continue;
      }

      const range = activityByActor.get(event.actor);
      if (!range) {
        activityByActor.set(event.actor, {
          earliestAt: seenAt,
          latestAt: seenAt,
        });
      } else {
        if (seenAt < range.earliestAt) range.earliestAt = seenAt;
        if (seenAt > range.latestAt) range.latestAt = seenAt;
      }
    }

    for (const [rawActorId, range] of activityByActor) {
      await this.people.recordActivitySighting(this.prisma, {
        organizationId,
        provider,
        rawActorId,
        displayText: rawActorId,
        kind: kindOf({ provider, rawActorId }),
        earliestAt: range.earliestAt,
        latestAt: range.latestAt,
      });
    }
    for (const [rawActorId, sighting] of directoryByActor) {
      await this.people.recordDirectorySighting(this.prisma, {
        organizationId,
        provider,
        rawActorId,
        displayText: sighting.displayText,
        seenAt: sighting.seenAt,
      });
    }

    return { discovered: activityByActor.size + directoryByActor.size };
  }
}

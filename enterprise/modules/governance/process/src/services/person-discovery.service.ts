// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { Temporal, toEpochMs, type Instant } from "@langwatch/time";

import {
  DISCOVERED_PERSON_KIND,
  type DiscoveredPersonRepository,
} from "../repositories/discovered-person.repository.ts";
import { DIRECTORY_REPORT_ACTION } from "../rules/microsoft-graph-directory.rules.ts";

/** ADR-128 §10: Databricks names service principals by bare UUID; elsewhere a UUID is a person. */
const DATABRICKS_PROVIDER = "databricks_genie";
const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SeenRange {
  earliestAt: Instant;
  latestAt: Instant;
}

interface DirectorySighting {
  displayText: string;
  department: string;
  seenAt: Instant;
}

function kindOf({ provider, rawActorId }: { provider: string; rawActorId: string }): string {
  return provider === DATABRICKS_PROVIDER && BARE_UUID.test(rawActorId)
    ? DISCOVERED_PERSON_KIND.SERVICE_ACCOUNT
    : DISCOVERED_PERSON_KIND.PERSON;
}

function extraString(event: NormalizedPullEvent, field: string): string {
  const value = event.extra?.[field];
  return typeof value === "string" ? value : "";
}

/** A person must never render as "": the directory's best name, then address, then the id. */
function directoryDisplayText(event: NormalizedPullEvent): string {
  return (
    extraString(event, "displayName") ||
    extraString(event, "mail") ||
    extraString(event, "userPrincipalName") ||
    event.actor
  );
}

function widenRange({
  activityByActor,
  actor,
  seenAt,
}: {
  activityByActor: Map<string, SeenRange>;
  actor: string;
  seenAt: Instant;
}): void {
  const range = activityByActor.get(actor);
  if (!range) {
    activityByActor.set(actor, { earliestAt: seenAt, latestAt: seenAt });
    return;
  }
  if (Temporal.Instant.compare(seenAt, range.earliestAt) < 0) range.earliestAt = seenAt;
  if (Temporal.Instant.compare(seenAt, range.latestAt) > 0) range.latestAt = seenAt;
}

function bucketByActor(events: NormalizedPullEvent[]): {
  activityByActor: Map<string, SeenRange>;
  directoryByActor: Map<string, DirectorySighting>;
} {
  const activityByActor = new Map<string, SeenRange>();
  const directoryByActor = new Map<string, DirectorySighting>();

  for (const event of events) {
    if (event.actor === "") continue;
    const epochMs = toEpochMs(event.event_timestamp);
    if (Number.isNaN(epochMs)) continue;
    const seenAt = Temporal.Instant.fromEpochMilliseconds(epochMs);

    if (event.action === DIRECTORY_REPORT_ACTION) {
      directoryByActor.set(event.actor, {
        displayText: directoryDisplayText(event),
        department: extraString(event, "department").trim(),
        seenAt,
      });
      continue;
    }
    widenRange({ activityByActor, actor: event.actor, seenAt });
  }

  return { activityByActor, directoryByActor };
}

/**
 * The feed that discovers people (ADR-128 §10–11), fed only the events that passed erasure
 * suppression. Activity rows widen the seen range; directory rows name and file a person but
 * never move the range. Spec: specs/governance/governance-people-discovery.feature
 */
export class PersonDiscoveryService {
  private readonly people: DiscoveredPersonRepository;

  private constructor({ people }: { people: DiscoveredPersonRepository }) {
    this.people = people;
  }

  static create({ people }: { people: DiscoveredPersonRepository }): PersonDiscoveryService {
    return new PersonDiscoveryService({ people });
  }

  /** One write per distinct actor; the repository's widen-only writes make a replay a no-op. */
  async recordFromPulledEvents({
    organizationId,
    provider,
    events,
  }: {
    organizationId: string;
    provider: string;
    events: NormalizedPullEvent[];
  }): Promise<{ discovered: number }> {
    const { activityByActor, directoryByActor } = bucketByActor(events);

    for (const [rawActorId, range] of activityByActor) {
      await this.people.recordActivitySighting({
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
      await this.people.recordDirectorySighting({
        organizationId,
        provider,
        rawActorId,
        displayText: sighting.displayText,
        department: sighting.department,
        seenAt: sighting.seenAt,
      });
    }

    return { discovered: activityByActor.size + directoryByActor.size };
  }
}

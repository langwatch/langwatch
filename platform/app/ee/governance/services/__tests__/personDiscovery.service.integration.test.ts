// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The discovery feed against real Postgres.
 *
 * What lives here is everything that is a constraint or a conditional WHERE:
 * that a replayed window is a no-op, that the seen range only ever widens,
 * that two providers naming one email are two rows under the unique key, and
 * that a directory sighting upgrades text without touching the range. An
 * application-level double would pass all of it with the WHEREs absent.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 * Decision: ADR-128 §10–11
 */
import { nanoid } from "nanoid";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import {
  DISCOVERED_PERSON_KIND,
  DiscoveredPersonRepository,
} from "../../repositories/governanceIdentity.repository";
import { PersonDiscoveryService } from "../personDiscovery.service";
import { DIRECTORY_REPORT_ACTION } from "../pullers/microsoftGraphDirectory";
import type { NormalizedPullEvent } from "../pullers/pullerAdapter";

const ns = nanoid(8);
const organizationId = `org_discovery_${ns}`;

const service = () => PersonDiscoveryService.create(prisma);

/** An activity event, with only what a test varies spelled out. */
const activityEvent = (
  over: Partial<NormalizedPullEvent>,
): NormalizedPullEvent => ({
  source_event_id: `evt_${nanoid(6)}`,
  event_timestamp: "2026-08-10T12:00:00.000Z",
  actor: "m.silva@acme.test",
  action: "cost_report",
  target: "gpt-5",
  cost_usd: "1.25",
  tokens_input: 0,
  tokens_output: 0,
  raw_payload: "{}",
  ...over,
});

const directoryEvent = (over: {
  actor: string;
  displayName?: string;
  mail?: string;
  department?: string;
  timestamp?: string;
}): NormalizedPullEvent => ({
  source_event_id: `dir_${nanoid(6)}`,
  event_timestamp: over.timestamp ?? "2026-09-01T00:00:00.000Z",
  actor: over.actor,
  action: DIRECTORY_REPORT_ACTION,
  target: over.department ?? "",
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
  raw_payload: "{}",
  extra: {
    directoryId: over.actor,
    displayName: over.displayName ?? "",
    mail: over.mail ?? "",
    userPrincipalName: "",
    department: over.department ?? "",
    accountEnabled: true,
  },
});

const personRows = () =>
  prisma.discoveredPerson.findMany({
    where: { organizationId },
    orderBy: [{ provider: "asc" }, { rawActorId: "asc" }],
  });

beforeEach(() =>
  cleanupTestRows(prisma, [["discoveredPerson", { organizationId }]]),
);

afterAll(() =>
  cleanupTestRows(prisma, [["discoveredPerson", { organizationId }]]),
);

describe("given a provider's pulled rows naming an actor", () => {
  /** @scenario "An actor on a pulled row becomes a discovered person" */
  it("becomes a discovered person with the event's own time as both seen dates", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "openai_admin",
      events: [activityEvent({})],
    });

    const rows = await personRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "openai_admin",
      rawActorId: "m.silva@acme.test",
      displayText: "m.silva@acme.test",
      kind: DISCOVERED_PERSON_KIND.PERSON,
      firstSeenAt: new Date("2026-08-10T12:00:00.000Z"),
      lastSeenAt: new Date("2026-08-10T12:00:00.000Z"),
    });
  });

  /** @scenario "Seeing the same actor again moves last-seen forward only" */
  it("only ever widens the seen range on later sightings, in either direction", async () => {
    const at = (iso: string) => activityEvent({ event_timestamp: iso });
    await service().recordFromPulledEvents({
      organizationId,
      provider: "openai_admin",
      events: [at("2026-08-10T12:00:00.000Z")],
    });
    // A later event moves last-seen forward and leaves first-seen alone; an
    // earlier one — a September run backfilling July — does the opposite.
    await service().recordFromPulledEvents({
      organizationId,
      provider: "openai_admin",
      events: [at("2026-08-20T09:00:00.000Z"), at("2026-07-01T00:00:00.000Z")],
    });

    const rows = await personRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.firstSeenAt).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(rows[0]?.lastSeenAt).toEqual(new Date("2026-08-20T09:00:00.000Z"));

    // Replaying the whole window again changes nothing.
    await service().recordFromPulledEvents({
      organizationId,
      provider: "openai_admin",
      events: [at("2026-08-10T12:00:00.000Z"), at("2026-07-01T00:00:00.000Z")],
    });
    expect(await personRows()).toEqual(rows);
  });

  /** @scenario "The same identifier on two providers is two discovered people" */
  it("is two discovered people when two providers name the same email", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "openai_admin",
      events: [activityEvent({})],
    });
    await service().recordFromPulledEvents({
      organizationId,
      provider: "anthropic_admin",
      events: [activityEvent({})],
    });

    const rows = await personRows();
    expect(rows.map((r) => r.provider)).toEqual([
      "anthropic_admin",
      "openai_admin",
    ]);
  });
});

describe("given rows that must not become people", () => {
  /** @scenario "A row naming nobody discovers nobody" */
  it("discovers nobody from an empty actor", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [activityEvent({ actor: "" })],
    });
    expect(await personRows()).toHaveLength(0);
  });

  /** @scenario "A bare-UUID Databricks actor is recorded as a machine login" */
  it("records a bare-UUID Databricks actor as a machine login", async () => {
    const uuid = "2f6b6a10-9f21-4d3a-8f01-6f2f1a9c1b2d";
    await service().recordFromPulledEvents({
      organizationId,
      provider: "databricks_genie",
      events: [activityEvent({ actor: uuid })],
    });

    const rows = await personRows();
    expect(rows[0]?.kind).toBe(DISCOVERED_PERSON_KIND.SERVICE_ACCOUNT);
  });

  it("keeps a UUID-shaped directory id a person — the rule is Databricks', not a shape rule", async () => {
    const oid = "f6481ec4-0000-4000-8000-2a8f29bb1c4a";
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria Silva" })],
    });

    const rows = await personRows();
    expect(rows[0]?.kind).toBe(DISCOVERED_PERSON_KIND.PERSON);
  });
});

describe("given a directory listing of the tenant's people", () => {
  const oid = "f6481ec4-0000-4000-8000-2a8f29bb1c4a";

  it("creates the person under their best name", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria Silva" })],
    });

    const rows = await personRows();
    expect(rows[0]).toMatchObject({
      rawActorId: oid,
      displayText: "Maria Silva",
    });
  });

  /** @scenario "A directory row enriches a discovered person's display text" */
  it("upgrades the display text of a person activity discovered as a bare id", async () => {
    // Activity saw the id first — a transcript knows people only as GUIDs.
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [activityEvent({ actor: oid, action: "conversation" })],
    });
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria Silva" })],
    });

    const rows = await personRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayText).toBe("Maria Silva");
  });

  it("never widens the seen range — a directory lists presence, not activity", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [
        activityEvent({
          actor: oid,
          action: "conversation",
          event_timestamp: "2026-08-10T12:00:00.000Z",
        }),
      ],
    });
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [
        directoryEvent({
          actor: oid,
          displayName: "Maria Silva",
          timestamp: "2026-09-02T00:00:00.000Z",
        }),
      ],
    });

    const rows = await personRows();
    expect(rows[0]?.lastSeenAt).toEqual(new Date("2026-08-10T12:00:00.000Z"));
  });

  /** @scenario "A directory row records the department it names on the person" */
  it("records the department the directory filed the person under", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [
        directoryEvent({
          actor: oid,
          displayName: "Maria Silva",
          department: "Engineering",
        }),
      ],
    });

    const rows = await personRows();
    expect(rows[0]?.department).toBe("Engineering");
  });

  it("records no department for a person the directory filed under none", async () => {
    // Null, not "": a tenant leaving the field blank is an absence of
    // information, never a claim that this person has no department.
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria Silva" })],
    });

    const rows = await personRows();
    expect(rows[0]?.department).toBeNull();
  });

  /** @scenario "A later directory row naming no department keeps the recorded one" */
  it("keeps the recorded department when a later sighting names none", async () => {
    const named = () =>
      service().recordFromPulledEvents({
        organizationId,
        provider: "copilot_studio_dataverse",
        events: [
          directoryEvent({
            actor: oid,
            displayName: "Maria Silva",
            department: "Engineering",
          }),
        ],
      });
    await named();
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria Silva" })],
    });

    expect((await personRows())[0]?.department).toBe("Engineering");

    // And a blank department does not stop the display text upgrade travelling
    // on the same row — the two texts widen independently.
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria S. Silva" })],
    });
    const after = (await personRows())[0];
    expect(after?.displayText).toBe("Maria S. Silva");
    expect(after?.department).toBe("Engineering");
  });

  it("moves the person when the directory names a different department", async () => {
    // Whitespace-only is the tenant leaving it blank, so the move has to come
    // from a real second name rather than from any non-empty string.
    const filedUnder = async (department: string) =>
      await service().recordFromPulledEvents({
        organizationId,
        provider: "copilot_studio_dataverse",
        events: [
          directoryEvent({
            actor: oid,
            displayName: "Maria Silva",
            department,
          }),
        ],
      });
    await filedUnder("Engineering");
    await filedUnder("   ");
    expect((await personRows())[0]?.department).toBe("Engineering");

    await filedUnder("Product");
    expect((await personRows())[0]?.department).toBe("Product");
  });

  /** @scenario "Erasing a person removes the department the directory gave them" */
  it("drops the department when the identity is erased", async () => {
    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [
        directoryEvent({
          actor: oid,
          displayName: "Maria Silva",
          department: "Engineering",
        }),
      ],
    });
    const before = (await personRows())[0]!;

    await new DiscoveredPersonRepository().pseudonymize(prisma, {
      id: before.id,
      organizationId,
      pseudonym: "pseudonym_abc",
      erasedAt: new Date("2026-09-03T00:00:00.000Z"),
    });

    const after = (await personRows())[0];
    expect(after?.department).toBeNull();
    expect(after?.displayText).toBe("pseudonym_abc");
  });

  it("never rewrites an erased row's text", async () => {
    // An erased person's key is a pseudonym, so a directory row's plaintext id
    // cannot address it — this pins the belt-and-braces WHERE for the day a
    // pseudonym ever collides with a real identifier.
    await prisma.discoveredPerson.create({
      data: {
        organizationId,
        provider: "copilot_studio_dataverse",
        rawActorId: oid,
        displayText: "pseudonym_abc",
        kind: DISCOVERED_PERSON_KIND.PERSON,
        firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        erasedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    await service().recordFromPulledEvents({
      organizationId,
      provider: "copilot_studio_dataverse",
      events: [directoryEvent({ actor: oid, displayName: "Maria Silva" })],
    });

    const rows = await personRows();
    expect(rows[0]?.displayText).toBe("pseudonym_abc");
  });
});

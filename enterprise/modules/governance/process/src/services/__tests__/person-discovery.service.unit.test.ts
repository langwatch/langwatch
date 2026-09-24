// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { DISCOVERED_PERSON_KIND } from "../../repositories/discovered-person.repository.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { DIRECTORY_REPORT_ACTION } from "../../rules/microsoft-graph-directory.rules.ts";
import { PersonDiscoveryService } from "../person-discovery.service.ts";

const ORG = "org_discovery";
const OID = "f6481ec4-0000-4000-8000-2a8f29bb1c4a";
const at = (iso: string) => Temporal.Instant.from(iso);

const activityEvent = (over: Partial<NormalizedPullEvent> = {}): NormalizedPullEvent => ({
  source_event_id: "evt_1",
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

const directoryEvent = ({
  actor,
  displayName = "",
  department = "",
  timestamp = "2026-09-01T00:00:00.000Z",
}: {
  actor: string;
  displayName?: string;
  department?: string;
  timestamp?: string;
}): NormalizedPullEvent => ({
  source_event_id: "dir_1",
  event_timestamp: timestamp,
  actor,
  action: DIRECTORY_REPORT_ACTION,
  target: department,
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
  raw_payload: "{}",
  extra: {
    directoryId: actor,
    displayName,
    mail: "",
    userPrincipalName: "",
    department,
    accountEnabled: true,
  },
});

function buildWorld() {
  const repositories = MemoryGovernanceRepositories.create();
  const service = PersonDiscoveryService.create({ people: repositories.discoveredPeople });
  const record = (provider: string, events: NormalizedPullEvent[]) =>
    service.recordFromPulledEvents({ organizationId: ORG, provider, events });
  const personRows = async () =>
    (await repositories.discoveredPeople.findByOrganization({ organizationId: ORG })).toSorted(
      (a, b) => a.provider.localeCompare(b.provider) || a.rawActorId.localeCompare(b.rawActorId),
    );
  return { repositories, record, personRows };
}

describe("PersonDiscoveryService", () => {
  describe("given a provider's pulled rows naming an actor", () => {
    it("becomes a discovered person with the event's own time as both seen dates", async () => {
      const { record, personRows } = buildWorld();
      await record("openai_admin", [activityEvent()]);

      const rows = await personRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        provider: "openai_admin",
        rawActorId: "m.silva@acme.test",
        displayText: "m.silva@acme.test",
        kind: DISCOVERED_PERSON_KIND.PERSON,
        firstSeenAt: at("2026-08-10T12:00:00.000Z"),
        lastSeenAt: at("2026-08-10T12:00:00.000Z"),
      });
    });

    it("only ever widens the seen range on later sightings, in either direction", async () => {
      const { record, personRows } = buildWorld();
      const sighting = (iso: string) => activityEvent({ event_timestamp: iso });
      await record("openai_admin", [sighting("2026-08-10T12:00:00.000Z")]);
      await record("openai_admin", [
        sighting("2026-08-20T09:00:00.000Z"),
        sighting("2026-07-01T00:00:00.000Z"),
      ]);

      const rows = await personRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.firstSeenAt).toEqual(at("2026-07-01T00:00:00.000Z"));
      expect(rows[0]?.lastSeenAt).toEqual(at("2026-08-20T09:00:00.000Z"));

      await record("openai_admin", [
        sighting("2026-08-10T12:00:00.000Z"),
        sighting("2026-07-01T00:00:00.000Z"),
      ]);
      expect(await personRows()).toEqual(rows);
    });

    it("is two discovered people when two providers name the same email", async () => {
      const { record, personRows } = buildWorld();
      await record("openai_admin", [activityEvent()]);
      await record("anthropic_admin", [activityEvent()]);

      expect((await personRows()).map((row) => row.provider)).toEqual([
        "anthropic_admin",
        "openai_admin",
      ]);
    });

    it("skips an event whose timestamp cannot be read", async () => {
      const { record, personRows } = buildWorld();
      const { discovered } = await record("openai_admin", [
        activityEvent({ event_timestamp: "not a date" }),
      ]);

      expect(discovered).toBe(0);
      expect(await personRows()).toHaveLength(0);
    });
  });

  describe("given rows that must not become people", () => {
    it("discovers nobody from an empty actor", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [activityEvent({ actor: "" })]);

      expect(await personRows()).toHaveLength(0);
    });

    /** @scenario "A bare-UUID Databricks actor is recorded as a machine login" */
    it("records a bare-UUID Databricks actor as a machine login", async () => {
      const { record, personRows } = buildWorld();
      await record("databricks_genie", [
        activityEvent({ actor: "2f6b6a10-9f21-4d3a-8f01-6f2f1a9c1b2d" }),
      ]);

      expect((await personRows())[0]?.kind).toBe(DISCOVERED_PERSON_KIND.SERVICE_ACCOUNT);
    });

    it("keeps a UUID-shaped directory id a person — the rule is Databricks', not a shape rule", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva" }),
      ]);

      expect((await personRows())[0]?.kind).toBe(DISCOVERED_PERSON_KIND.PERSON);
    });
  });

  describe("given a directory listing of the tenant's people", () => {
    it("creates the person under their best name", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva" }),
      ]);

      expect((await personRows())[0]).toMatchObject({
        rawActorId: OID,
        displayText: "Maria Silva",
      });
    });

    it("upgrades the display text of a person activity discovered as a bare id", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        activityEvent({ actor: OID, action: "conversation" }),
      ]);
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva" }),
      ]);

      const rows = await personRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.displayText).toBe("Maria Silva");
    });

    it("never widens the seen range — a directory lists presence, not activity", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        activityEvent({
          actor: OID,
          action: "conversation",
          event_timestamp: "2026-08-10T12:00:00.000Z",
        }),
      ]);
      await record("copilot_studio_dataverse", [
        directoryEvent({
          actor: OID,
          displayName: "Maria Silva",
          timestamp: "2026-09-02T00:00:00.000Z",
        }),
      ]);

      expect((await personRows())[0]?.lastSeenAt).toEqual(at("2026-08-10T12:00:00.000Z"));
    });

    it("records the department the directory filed the person under", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva", department: "Engineering" }),
      ]);

      expect((await personRows())[0]?.department).toBe("Engineering");
    });

    it("records no department for a person the directory filed under none", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva" }),
      ]);

      expect((await personRows())[0]?.department).toBeNull();
    });

    it("keeps the recorded department when a later sighting names none", async () => {
      const { record, personRows } = buildWorld();
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva", department: "Engineering" }),
      ]);
      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria Silva" }),
      ]);
      expect((await personRows())[0]?.department).toBe("Engineering");

      await record("copilot_studio_dataverse", [
        directoryEvent({ actor: OID, displayName: "Maria S. Silva" }),
      ]);
      const after = (await personRows())[0];
      expect(after?.displayText).toBe("Maria S. Silva");
      expect(after?.department).toBe("Engineering");
    });

    it("moves the person when the directory names a different department", async () => {
      const { record, personRows } = buildWorld();
      const filedUnder = (department: string) =>
        record("copilot_studio_dataverse", [
          directoryEvent({ actor: OID, displayName: "Maria Silva", department }),
        ]);
      await filedUnder("Engineering");
      await filedUnder("   ");
      expect((await personRows())[0]?.department).toBe("Engineering");

      await filedUnder("Product");
      expect((await personRows())[0]?.department).toBe("Product");
    });
  });
});

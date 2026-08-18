/**
 * Unit coverage for Management Activity API record mapping.
 *
 * Most of these pin an absence rather than a value: three identifiers that
 * must not be conflated, an object id the record does not carry, a cost the
 * source cannot report, and an inventory join we deliberately do not make.
 * Each one is a place where inventing a plausible value would put a wrong
 * fact into a compliance record.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { describe, expect, it } from "vitest";

import {
  COPILOT_INTERACTION_RECORD_TYPE,
  isNonHumanActor,
  Microsoft365AuditPuller,
  mapAuditRecord,
} from "../microsoft365Audit.puller";

const UPN = "user@tenant-domain";
const PUID = "100320022AB01F3C";
const AGENT_ID =
  "CopilotStudio.Declarative.7f1c0c1e-0000-0000-0000-000000000000";

const record = (overrides: Record<string, unknown> = {}) => ({
  Id: "5c1b0a9e-0000-0000-0000-000000000001",
  RecordType: COPILOT_INTERACTION_RECORD_TYPE,
  CreationTime: "2026-05-03T09:15:00",
  Operation: "CopilotInteraction",
  UserId: UPN,
  UserKey: PUID,
  UserType: 0,
  AgentId: AGENT_ID,
  AppIdentity: "Copilot.Studio.4d2b",
  Workload: "CopilotStudio",
  ...overrides,
});

describe("mapAuditRecord", () => {
  /** @scenario "The three user identifiers are mapped to distinct fields" */
  it("keeps the UPN and the PUID apart and claims no Entra object id", () => {
    const mapped = mapAuditRecord(record());

    expect(mapped.actor).toBe(UPN);
    expect(mapped.extra?.user_principal_name).toBe(UPN);
    expect(mapped.extra?.user_key_puid).toBe(PUID);
    // Different identifiers, never collapsed into one another.
    expect(mapped.extra?.user_principal_name).not.toBe(
      mapped.extra?.user_key_puid,
    );

    // The record carries no Entra object id, so no field may imply one.
    const keys = Object.keys(mapped.extra ?? {});
    expect(keys.some((k) => /object_id|entra_id|oid/i.test(k))).toBe(false);
  });

  /** @scenario "Non-human actors are not attributed to a person" */
  it("marks application and service-principal actors instead of naming a human", () => {
    for (const userType of [5, 6]) {
      const mapped = mapAuditRecord(record({ UserType: userType }));

      expect(isNonHumanActor(record({ UserType: userType }))).toBe(true);
      expect(mapped.extra?.is_non_human_actor).toBe(true);
      // No human is named, even though the record has a UserId string.
      expect(mapped.actor).toBe("");
    }

    const human = mapAuditRecord(record({ UserType: 0 }));
    expect(human.extra?.is_non_human_actor).toBe(false);
    expect(human.actor).toBe(UPN);
  });

  /** @scenario "Cost and token fields are zero because the source cannot carry them" */
  it("reports zero cost and tokens rather than estimating them", () => {
    const mapped = mapAuditRecord(record());

    expect(mapped.cost_usd).toBe(0);
    expect(mapped.tokens_input).toBe(0);
    expect(mapped.tokens_output).toBe(0);

    // Still zero when the record carries a Messages[].Size, which Microsoft
    // documents as unused — reading it would be inventing a number.
    const withSize = mapAuditRecord(
      record({ Messages: [{ Size: 4096 }] }) as Record<string, unknown>,
    );
    expect(withSize.cost_usd).toBe(0);
    expect(withSize.tokens_input).toBe(0);
  });

  /** @scenario "Raw payload is preserved verbatim for downstream replay" */
  it("preserves the original record verbatim", () => {
    const original = record();
    const mapped = mapAuditRecord(original);

    expect(JSON.parse(mapped.raw_payload)).toEqual(original);
  });

  /** @scenario "AgentId is carried through without asserting an inventory join" */
  it("carries AgentId verbatim, joins nothing, and records the missing environment", () => {
    const mapped = mapAuditRecord(record());

    expect(mapped.extra?.agent_id).toBe(AGENT_ID);
    expect(mapped.target).toBe(AGENT_ID);

    // No botId is asserted: the equivalence is undocumented, so a join here
    // would be a guess wearing the shape of a fact.
    const keys = Object.keys(mapped.extra ?? {});
    expect(keys.some((k) => /bot_id|botId/i.test(k))).toBe(false);

    // Agent ids are environment-scoped; the record is not. Say so.
    expect(mapped.extra?.environment_id).toBeNull();
  });

  /** @scenario "Dedup key is derived only from record content" */
  it("derives source_event_id from the record so re-drains collapse", () => {
    const first = mapAuditRecord(record());
    const second = mapAuditRecord(record());

    // Same record mapped in two separate runs produces the same id. The
    // worker builds the dedup key as
    // `${sourceType}:${sourceId}:${source_event_id}` (pullerWorker.ts:283),
    // so this is what makes a re-drained blob collapse rather than
    // double-count — the property the whole restart design rests on.
    expect(first.source_event_id).toBe(second.source_event_id);
    expect(first.source_event_id).toBe("5c1b0a9e-0000-0000-0000-000000000001");

    // Nothing run-scoped leaks into it.
    expect(first.source_event_id).not.toMatch(/\d{13}/); // no epoch ms
    const differentRecord = mapAuditRecord(record({ Id: "other-id" }));
    expect(differentRecord.source_event_id).toBe("other-id");
  });
});

describe("Microsoft365AuditPuller.validateConfig", () => {
  const valid = {
    adapter: "microsoft_365_audit",
    tenantId: "acme-tenant-guid",
    contentType: "Audit.General",
    schedule: "*/15 * * * *",
    credentials: {
      tenantId: "acme-tenant-guid",
      clientId: "acme-app-guid",
      clientSecret: "a-secret",
    },
  };

  /** @scenario "Config shape validates" */
  it("accepts a complete config", () => {
    const adapter = new Microsoft365AuditPuller();
    expect(() => adapter.validateConfig(valid)).not.toThrow();
    expect(adapter.id).toBe("microsoft_365_audit");
  });

  /** @scenario "Config missing any credential field is rejected with a registered error code" */
  it("rejects each missing credential by name without echoing any value", () => {
    const adapter = new Microsoft365AuditPuller();

    for (const field of ["tenantId", "clientId", "clientSecret"] as const) {
      const credentials = { ...valid.credentials };
      delete (credentials as Record<string, unknown>)[field];

      let raised: unknown;
      try {
        adapter.validateConfig({ ...valid, credentials });
      } catch (error) {
        raised = error;
      }

      expect(raised, field).toBeDefined();
      const message = JSON.stringify(raised);
      expect(message, field).toContain(field);
      // The rejection must not quote the secret back.
      expect(message, field).not.toContain("a-secret");
    }
  });
});

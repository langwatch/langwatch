import {
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  emptySsoConnection,
  SSO_DNS_REPROOF_GRACE_MS,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

/**
 * What a re-read of a published proof states, and what it deliberately does
 * not (specs/identity/sso-domain-verification.feature, ADR-123).
 */

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const SYSTEM = { type: "system" as const, id: null };
const T0 = 1_756_000_000_000;

const command = (occurredAtMs: number) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId: `ssocmd_${occurredAtMs}`,
  occurredAtMs,
  actor: SYSTEM,
  source: "self-serve" as const,
});

let connections: InMemoryConnections;
let guards: SsoConnectionGuardsService;

function seed(proof: Partial<SsoDomainVerification> & { method: SsoDomainVerification["method"] }) {
  const state: SsoConnectionState = {
    ...emptySsoConnection({ connectionId: CONNECTION }),
    organizationId: ORG,
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
    domainVerifications: [
      {
        domain: "acme.com",
        actorId: "user_ana",
        verifiedAtMs: T0,
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        ...proof,
      },
    ],
  };
  connections.seed(state);

  return state;
}

beforeEach(() => {
  connections = new InMemoryConnections();
  guards = SsoConnectionGuardsService.create({
    connections,
    breakGlass: new StubBreakGlassBindings(true),
    stranding: new StubStranding(),
    platformOperators: new StubPlatformOperators(),
  });
});

describe("given a domain a published record proved", () => {
  describe("when a re-check finds no matching record", () => {
    /** @scenario "A record that has gone missing starts a clock and changes nothing else" */
    it("starts the clock, records the deadline, and moves nothing else", async () => {
      seed({ method: "dns-txt" });

      const facts = await guards.recordDomainProofAbsent({
        ...command(T0),
        domain: "acme.com",
        graceMs: SSO_DNS_REPROOF_GRACE_MS,
      });

      expect(facts).toEqual([
        {
          type: DOMAIN_PROOF_WAVERED_EVENT_TYPE,
          data: {
            connectionId: CONNECTION,
            domain: "acme.com",
            firstAbsentAtMs: T0,
            graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS,
            actor: SYSTEM,
            source: "self-serve",
          },
        },
      ]);

      const state = connections.apply({ connectionId: CONNECTION, facts, occurredAt: T0 });
      expect(state.state).toBe("ACTIVE");
      expect(state.verifiedDomains).toEqual(["acme.com"]);
      expect(state.domainVerifications[0]?.proofState).toBe("WAVERING");
    });
  });

  describe("when the record is still missing before the deadline", () => {
    /** @scenario "A re-check that finds everything where it was records nothing" */
    it("states nothing, because nothing about the world changed", async () => {
      seed({
        method: "dns-txt",
        proofState: "WAVERING",
        firstAbsentAtMs: T0,
        graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS,
      });

      expect(
        await guards.recordDomainProofAbsent({
          ...command(T0 + SSO_DNS_REPROOF_GRACE_MS - 1),
          domain: "acme.com",
          graceMs: SSO_DNS_REPROOF_GRACE_MS,
        }),
      ).toEqual([]);
    });
  });

  describe("when the record is still missing past the deadline", () => {
    /** @scenario "Forty-eight hours of continued absence is a lapse" */
    it("lapses the proof, saying how long the record had been gone", async () => {
      seed({
        method: "dns-txt",
        proofState: "WAVERING",
        firstAbsentAtMs: T0,
        graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS,
      });
      const past = T0 + SSO_DNS_REPROOF_GRACE_MS;

      const facts = await guards.recordDomainProofAbsent({
        ...command(past),
        domain: "acme.com",
        // A shorter window composed later must not move a running clock.
        graceMs: 1_000,
      });

      expect(facts).toEqual([
        {
          type: DOMAIN_PROOF_LAPSED_EVENT_TYPE,
          data: {
            connectionId: CONNECTION,
            domain: "acme.com",
            firstAbsentAtMs: T0,
            actor: SYSTEM,
            source: "self-serve",
          },
        },
      ]);

      const state = connections.apply({ connectionId: CONNECTION, facts, occurredAt: past });
      expect(state.verifiedDomains).toEqual(["acme.com"]);
      expect(state.domainVerifications[0]).toMatchObject({
        proofState: "LAPSED",
        firstAbsentAtMs: T0,
        graceEndsAtMs: null,
      });
    });

    /** @scenario "Forty-eight hours of continued absence is a lapse" */
    it("says nothing more once the domain has already lapsed", async () => {
      seed({ method: "dns-txt", proofState: "LAPSED", firstAbsentAtMs: T0, graceEndsAtMs: null });

      expect(
        await guards.recordDomainProofAbsent({
          ...command(T0 + SSO_DNS_REPROOF_GRACE_MS * 4),
          domain: "acme.com",
          graceMs: SSO_DNS_REPROOF_GRACE_MS,
        }),
      ).toEqual([]);
    });
  });

  describe("when the record is published again", () => {
    /** @scenario "Publishing the record again restores the domain with nothing to redo" */
    it("recovers the proof and says how long the evidence was missing", async () => {
      seed({ method: "dns-txt", proofState: "LAPSED", firstAbsentAtMs: T0, graceEndsAtMs: null });
      const back = T0 + SSO_DNS_REPROOF_GRACE_MS * 2;

      const facts = await guards.recordDomainProofPresent({
        ...command(back),
        domain: "acme.com",
      });

      expect(facts).toEqual([
        {
          type: DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
          data: {
            connectionId: CONNECTION,
            domain: "acme.com",
            absentForMs: SSO_DNS_REPROOF_GRACE_MS * 2,
            actor: SYSTEM,
            source: "self-serve",
          },
        },
      ]);

      const state = connections.apply({ connectionId: CONNECTION, facts, occurredAt: back });
      expect(state.domainVerifications[0]).toMatchObject({
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
      });
    });

    /** @scenario "A re-check that finds everything where it was records nothing" */
    it("states nothing at all for a domain nothing was doubting", async () => {
      seed({ method: "dns-txt" });

      expect(
        await guards.recordDomainProofPresent({ ...command(T0 + 1), domain: "acme.com" }),
      ).toEqual([]);
    });
  });
});

describe("given a domain no published proof ever proved", () => {
  describe("when something records a missing published proof against it", () => {
    /** @scenario "A domain no published proof ever proved is never doubted by DNS" */
    it("refuses, for the attested domain and the grandfathered one alike", async () => {
      for (const method of [
        "operator-attested",
        "legacy-configuration",
        "license-token",
      ] as const) {
        connections = new InMemoryConnections();
        guards = SsoConnectionGuardsService.create({
          connections,
          breakGlass: new StubBreakGlassBindings(true),
          stranding: new StubStranding(),
          platformOperators: new StubPlatformOperators(),
        });
        seed({ method });

        await expect(
          guards.recordDomainProofAbsent({
            ...command(T0),
            domain: "acme.com",
            graceMs: SSO_DNS_REPROOF_GRACE_MS,
          }),
        ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
      }
    });
  });

  describe("when the domain is not on the connection at all", () => {
    /** @scenario "A domain no published proof ever proved is never doubted by DNS" */
    it("refuses rather than doubting evidence it cannot see", async () => {
      seed({ method: "dns-txt" });

      await expect(
        guards.recordDomainProofPresent({ ...command(T0), domain: "beta.example" }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
    });
  });
});

describe("given a domain the file proved", () => {
  describe("when the file stops being served", () => {
    /** @scenario "A file that has gone missing starts the same clock a missing record does" */
    it("earns the same waver and the same deadline a missing record does", async () => {
      seed({ method: "https-file" });

      const facts = await guards.recordDomainProofAbsent({
        ...command(T0),
        domain: "acme.com",
        graceMs: SSO_DNS_REPROOF_GRACE_MS,
      });

      expect(facts[0]).toMatchObject({
        type: DOMAIN_PROOF_WAVERED_EVENT_TYPE,
        data: { graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS },
      });
    });
  });
});

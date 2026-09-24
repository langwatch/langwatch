import {
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  VERIFICATION_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const ANA = { type: "user" as const, id: "user_ana" };
const OPS = { type: "user" as const, id: "user_ops" };
const T0 = 1_756_000_000_000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const identity = {
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId: "ssocmd_1",
  occurredAtMs: T0,
  actor: ANA,
  source: "self-serve" as const,
};

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [],
};

let connections: InMemoryConnections;
let guards: SsoConnectionGuardsService;

/** Run a verb and fold what it states, the way the pipeline does. */
async function run(
  verb: () => Promise<SsoConnectionFactInput[]>,
  occurredAt = T0,
): Promise<{ facts: SsoConnectionFactInput[]; state: SsoConnectionState }> {
  const facts = await verb();
  const state = connections.apply({ connectionId: CONNECTION, facts, occurredAt });
  return { facts, state };
}

/** A connection with one domain claimed and nobody at LangWatch consulted. */
async function reachClaimed(): Promise<void> {
  await run(() =>
    guards.registerConnection({ ...identity, type: "oidc", idp: IDP, arrivalPolicy: "admit" }),
  );
  await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
}

async function askForARecord(expiresAtMs: number | null = T0 + TTL_MS): Promise<void> {
  await run(() =>
    guards.requestVerification({
      ...identity,
      domain: "acme.com",
      method: "dns-txt",
      tokenHash: "sha256:proof",
      expiresAtMs,
    }),
  );
}

beforeEach(() => {
  connections = new InMemoryConnections();
  guards = SsoConnectionGuardsService.create({
    connections,
    registrationSlots: connections,
    breakGlass: new StubBreakGlassBindings(true),
    stranding: new StubStranding([]),
    platformOperators: new StubPlatformOperators([OPS.id]),
  });
});

describe("the published record decides the claim", () => {
  describe("given a claim nobody has decided", () => {
    /** @scenario "The approval is stated after the proof, never before it" */
    it("carries the claim and the record that was asked for, and no approval", async () => {
      await reachClaimed();

      const { facts, state } = await run(() =>
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:proof",
          expiresAtMs: T0 + TTL_MS,
        }),
      );

      expect(facts.map((fact) => fact.type)).toEqual([VERIFICATION_REQUESTED_EVENT_TYPE]);
      expect(state.claimedDomains).toEqual(["acme.com"]);
      expect(state.approvedDomains).toEqual([]);
      expect(state.pendingVerification).toEqual({
        domain: "acme.com",
        method: "dns-txt",
        tokenHash: "sha256:proof",
        expiresAtMs: T0 + TTL_MS,
      });
    });

    /** @scenario "Claiming the record's authority without the record proves nothing" */
    it("refuses an approval that claims the record's authority, and states nothing", async () => {
      await reachClaimed();

      await expect(
        guards.approveDomainClaim({
          ...identity,
          actor: OPS,
          domain: "acme.com",
          authority: "dns-proof",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });

      const state = await connections.getConnection({ connectionId: CONNECTION });
      expect(state?.approvedDomains).toEqual([]);
    });

    it("approves and proves in one act when the check reads the record", async () => {
      await reachClaimed();
      await askForARecord();

      const { facts, state } = await run(() =>
        guards.verifyDomain({ ...identity, domain: "acme.com", channel: "dns-txt" }),
      );

      expect(facts.map((fact) => fact.type)).toEqual([
        DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
        DOMAIN_VERIFIED_EVENT_TYPE,
      ]);
      // The approval says what authorized it, permanently: a dispute about
      // this domain is answered from the history and nothing else.
      expect(facts[0]?.data).toMatchObject({ authority: "dns-proof", actor: ANA });
      expect(state.verifiedDomains).toEqual(["acme.com"]);
      expect(state.claimedDomains).toEqual([]);
    });

    it("leaves an operator's own approval saying so", async () => {
      await reachClaimed();

      const { facts } = await run(() =>
        guards.approveDomainClaim({ ...identity, actor: OPS, domain: "acme.com" }),
      );

      expect(facts[0]?.type).toBe(DOMAIN_CLAIM_APPROVED_EVENT_TYPE);
      expect(facts[0]?.data).toMatchObject({ authority: "platform-operator" });
    });
  });

  describe("given one minted token and two ways to publish it", () => {
    it("records the channel the check actually read it from", async () => {
      await reachClaimed();
      await askForARecord();

      const { facts, state } = await run(() =>
        guards.verifyDomain({ ...identity, domain: "acme.com", channel: "https-file" }),
      );

      expect(facts.at(-1)?.data).toMatchObject({ method: "https-file" });
      // The hash still travels, so a domain the file proved is re-read at
      // its file rather than never again.
      expect(state.domainVerifications).toEqual([
        expect.objectContaining({ method: "https-file", tokenHash: "sha256:proof" }),
      ]);
    });

    it("refuses a channel named against a ceremony that published nothing", async () => {
      await reachClaimed();
      await run(() => guards.approveDomainClaim({ ...identity, actor: OPS, domain: "acme.com" }));
      await run(() =>
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "license-token",
          tokenHash: "sha256:licence",
        }),
      );

      await expect(
        guards.verifyDomain({ ...identity, domain: "acme.com", channel: "dns-txt" }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
    });

    it("refuses a licence ceremony standing in for the decision on a claim", async () => {
      await reachClaimed();

      await expect(
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "license-token",
          tokenHash: "sha256:licence",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
    });
  });

  describe("given the record was found after its expiry", () => {
    /** @scenario "A ceremony that expired is re-proved through the same check" */
    it("proves nothing, and the same check proves it once a fresh record is asked for", async () => {
      await reachClaimed();
      await askForARecord();

      await expect(
        guards.verifyDomain({
          ...identity,
          occurredAtMs: T0 + TTL_MS + 1,
          domain: "acme.com",
          channel: "dns-txt",
        }),
      ).rejects.toMatchObject({ code: "sso_domain_proof_expired" });

      await run(
        () =>
          guards.requestVerification({
            ...identity,
            occurredAtMs: T0 + TTL_MS + 2,
            domain: "acme.com",
            method: "dns-txt",
            tokenHash: "sha256:fresh",
            expiresAtMs: T0 + 2 * TTL_MS,
          }),
        T0 + TTL_MS + 2,
      );
      const { state } = await run(
        () =>
          guards.verifyDomain({
            ...identity,
            occurredAtMs: T0 + TTL_MS + 3,
            domain: "acme.com",
            channel: "dns-txt",
          }),
        T0 + TTL_MS + 3,
      );

      expect(state.verifiedDomains).toEqual(["acme.com"]);
    });

    it("keeps proving a ceremony nobody gave a deadline", async () => {
      await reachClaimed();
      await askForARecord(null);

      const { state } = await run(
        () =>
          guards.verifyDomain({
            ...identity,
            occurredAtMs: T0 + 10 * TTL_MS,
            domain: "acme.com",
            channel: "dns-txt",
          }),
        T0 + 10 * TTL_MS,
      );

      expect(state.verifiedDomains).toEqual(["acme.com"]);
    });
  });

  describe("given a domain nobody claimed", () => {
    it("has no claim a record may prove", async () => {
      await run(() =>
        guards.registerConnection({ ...identity, type: "oidc", idp: IDP, arrivalPolicy: "admit" }),
      );

      await expect(
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:proof",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });

      const state = await connections.getConnection({ connectionId: CONNECTION });
      expect(state?.pendingVerification ?? null).toBeNull();
    });

    it("still claims nothing when the claim was declined", async () => {
      await reachClaimed();
      await run(() =>
        guards.rejectDomainClaim({
          ...identity,
          actor: OPS,
          domain: "acme.com",
          note: "not yours",
        }),
      );

      await expect(
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:proof",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
    });
  });
});

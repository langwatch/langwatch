import {
  emptySsoConnection,
  SSO_DNS_REPROOF_GRACE_MS,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
  ssoDnsRecordName,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  SsoDomainFileFetch,
  SsoDomainProofFileChannel,
} from "../channels/sso-domain-proof-file.channel.ts";
import type {
  SsoDomainProofChannel,
  SsoDomainTxtLookup,
} from "../channels/sso-domain-proof.channel.ts";
import type {
  SsoDomainReproofTarget,
  SsoDomainReproofTargetRepository,
} from "../repositories/sso-domain-reproof.repository.ts";
import { sha256Hex } from "../rules/pkce.rules.ts";
import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import {
  SSO_DOMAIN_REPROOF_BATCH,
  SsoDomainReproofService,
} from "../services/sso-domain-reproof.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

/**
 * Re-reading the records that prove domains (ADR-123). Integration because
 * the answer is the composition: the sweep decides whether to command, the
 * guards whether the command states a fact, the fold what the connection is.
 */

const ORG = "org_acme";
const CONNECTION = "ssoc_acme";
const ANA = { type: "user" as const, id: "user_ana" };
const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const TOKEN = "lw-verification-token-acme";
const TOKEN_HASH = `sha256:${sha256Hex(TOKEN)}`;

class StubProofs implements SsoDomainProofChannel {
  answer: SsoDomainTxtLookup = { outcome: "published", values: [TOKEN] };
  asked: string[] = [];

  async lookupTxtValues({ name }: { domain: string; name: string }): Promise<SsoDomainTxtLookup> {
    this.asked.push(name);

    return this.answer;
  }
}

/** The file channel's re-read seam, for a domain the file proved. */
class StubFileReads implements SsoDomainProofFileChannel {
  answer: SsoDomainFileFetch = { outcome: "served", values: [TOKEN] };
  asked: string[] = [];

  async fetchVerificationFile({
    url,
  }: {
    domain: string;
    url: string;
  }): Promise<SsoDomainFileFetch> {
    this.asked.push(url);

    return this.answer;
  }
}

class StubTargets implements SsoDomainReproofTargetRepository {
  targets: SsoDomainReproofTarget[] = [
    {
      connectionId: CONNECTION,
      organizationId: ORG,
      domain: "acme.com",
      tokenHash: TOKEN_HASH,
      method: "dns-txt",
    },
  ];

  /** Which connections the sweep said it had looked at, in order. */
  swept: string[][] = [];

  async findDomainsProvedByRecord(): Promise<SsoDomainReproofTarget[]> {
    return this.targets;
  }

  async markSwept({ connectionIds }: { connectionIds: readonly string[] }): Promise<void> {
    this.swept.push([...connectionIds]);
  }
}

let connections: InMemoryConnections;
let proofs: StubProofs;
let fileReads: StubFileReads;
let targets: StubTargets;
let committed: { command: SsoConnectionCommand; facts: SsoConnectionFactInput[] }[];
let clock: number;
let connectionService: SsoConnectionService;
let reproof: SsoDomainReproofService;

/** A live connection a published record proved, with the ceremony's hash
 *  carried forward — which is what makes it re-readable at all. */
function seedProvedConnection(method: "dns-txt" | "https-file"): void {
  connections.seed({
    ...emptySsoConnection({ connectionId: CONNECTION }),
    organizationId: ORG,
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
    domainVerifications: [
      {
        domain: "acme.com",
        method,
        actorId: ANA.id,
        verifiedAtMs: T0,
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: TOKEN_HASH,
      },
    ],
    testLoginAccountId: "acc_test",
    createdBy: ANA.id,
    createdAtMs: T0,
    updatedAtMs: T0,
  });
}

beforeEach(() => {
  connections = new InMemoryConnections();
  proofs = new StubProofs();
  fileReads = new StubFileReads();
  targets = new StubTargets();
  committed = [];
  clock = T0;
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      if (facts.length > 0) committed.push({ command, facts });
      connections.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });

      return facts.map((fact) => ({ ...fact, occurredAt: command.data.occurredAtMs }));
    },
  };
  connectionService = SsoConnectionService.create(
    SsoConnectionGuardsService.create({
      connections,
      registrationSlots: connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding(),
      platformOperators: new StubPlatformOperators([OLIVE.id]),
    }),
    ledger,
  );
  reproof = SsoDomainReproofService.create({
    connections: () => connectionService,
    targets,
    proofs,
    files: fileReads,
    now: () => clock,
  });
  seedProvedConnection("dns-txt");
});

const held = async () => connections.tryFindConnection({ connectionId: CONNECTION });
const proofOf = async () =>
  (await held())?.domainVerifications.find((entry) => entry.domain === "acme.com");
const recorded = (): string[] =>
  committed.flatMap((entry) => entry.facts).map((fact) => fact.type.replace("lw.identity.", ""));

describe("re-reading the record that proves a domain", () => {
  describe("given the record has gone missing", () => {
    beforeEach(() => {
      proofs.answer = { outcome: "absent" };
    });

    /** @scenario "A record that has gone missing starts a clock and changes nothing else" */
    it("wavers the proof, records the deadline, and leaves everything else as it was", async () => {
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ checked: 1, wavered: 1, lapsed: 0 });
      expect(proofs.asked).toEqual([ssoDnsRecordName({ domain: "acme.com" })]);
      expect(await proofOf()).toMatchObject({
        proofState: "WAVERING",
        firstAbsentAtMs: T0,
        graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS,
        // What proved it is untouched: a waver speaks about the evidence's
        // condition, never about who proved it or how.
        method: "dns-txt",
        actorId: ANA.id,
      });
      const state = await held();
      expect(state?.state).toBe("ACTIVE");
      expect(state?.verifiedDomains).toEqual(["acme.com"]);
      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });

    /** @scenario "Forty-eight hours of continued absence is a lapse" */
    it("lapses only once the deadline has passed, and says how long it had been missing", async () => {
      await reproof.sweep();

      clock = T0 + HOUR_MS;
      await reproof.sweep();
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS - 1;
      await reproof.sweep();
      expect(recorded()).toEqual(["domain_proof_wavered"]);
      expect((await proofOf())?.proofState).toBe("WAVERING");

      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + 1;
      await reproof.sweep();
      expect(recorded()).toEqual(["domain_proof_wavered", "domain_proof_lapsed"]);
      const lapse = committed
        .flatMap((entry) => entry.facts)
        .find((fact) => fact.type === "lw.identity.domain_proof_lapsed");
      expect(lapse?.data).toMatchObject({ domain: "acme.com", firstAbsentAtMs: T0 });
    });

    /** @scenario "A lapse stops new people and stops nobody who is already here" */
    it("leaves the connection live and the domain owned once the proof has lapsed", async () => {
      await reproof.sweep();
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + 1;
      await reproof.sweep();

      expect((await proofOf())?.proofState).toBe("LAPSED");
      const state = await held();
      expect(state?.state).toBe("ACTIVE");
      expect(state?.verifiedDomains).toEqual(["acme.com"]);
      expect(await connections.tryFindDomainOwner({ domain: "acme.com" })).toMatchObject({
        connectionId: CONNECTION,
      });
    });

    /** @scenario "Publishing the record again restores the domain with nothing to redo" */
    it("recovers the proof on the next check, re-deciding no claim and minting no token", async () => {
      await reproof.sweep();
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + 1;
      await reproof.sweep();

      proofs.answer = { outcome: "published", values: [TOKEN] };
      clock += HOUR_MS;
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ recovered: 1 });
      expect(await proofOf()).toMatchObject({
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
      });
      expect(recorded()).toEqual([
        "domain_proof_wavered",
        "domain_proof_lapsed",
        "domain_proof_recovered",
      ]);
      expect((await held())?.pendingVerification).toBeNull();
    });
  });

  describe("given the lookup itself cannot be answered", () => {
    /** @scenario "A lookup that could not be answered starts nothing and advances nothing" */
    it("records nothing and never spends a customer's grace", async () => {
      proofs.answer = { outcome: "absent" };
      await reproof.sweep();
      expect(recorded()).toEqual(["domain_proof_wavered"]);

      proofs.answer = { outcome: "unreachable", reason: "SERVFAIL" };
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + HOUR_MS;
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ unreachable: 1, lapsed: 0, wavered: 0 });
      expect(recorded()).toEqual(["domain_proof_wavered"]);
      expect((await proofOf())?.proofState).toBe("WAVERING");
    });

    it("starts no clock at all on a healthy domain", async () => {
      proofs.answer = { outcome: "unreachable", reason: "ETIMEOUT" };
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ unreachable: 1, wavered: 0 });
      expect(recorded()).toEqual([]);
      expect((await proofOf())?.proofState).toBe("VERIFIED");
    });
  });

  describe("given the record is exactly where it should be", () => {
    /** @scenario "A re-check that finds everything where it was records nothing" */
    it("writes no history however many times it is read", async () => {
      for (let sweep = 0; sweep < 21; sweep += 1) {
        clock = T0 + sweep * 8 * HOUR_MS;
        await reproof.sweep();
      }

      expect(recorded()).toEqual([]);
      expect(committed).toEqual([]);
    });

    /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
    it("still records that it looked, so the next sweep moves on", async () => {
      await reproof.sweep();

      expect(recorded()).toEqual([]);
      expect(targets.swept).toEqual([[CONNECTION]]);
    });

    /** @scenario "Records published by other vendors on the same domain are not our token" */
    it("is not fooled by somebody else's record at the same name", async () => {
      proofs.answer = {
        outcome: "published",
        values: ["v=spf1 include:example.com ~all", `${TOKEN}-not-quite`],
      };

      await reproof.sweep();

      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });
  });

  describe("given a domain no published record ever proved", () => {
    /** @scenario "A domain no published proof ever proved is never doubted by DNS" */
    it("refuses to doubt an attested domain by name, and states nothing", async () => {
      connections.seed({
        ...emptySsoConnection({ connectionId: "ssoc_attested" }),
        organizationId: "org_beta",
        state: "ACTIVE",
        verifiedDomains: ["beta.example"],
        domainVerifications: [
          {
            domain: "beta.example",
            method: "operator-attested",
            actorId: OLIVE.id,
            verifiedAtMs: T0,
            proofState: "VERIFIED",
            firstAbsentAtMs: null,
            graceEndsAtMs: null,
            tokenHash: null,
          },
        ],
        testLoginAccountId: "acc_beta",
      });

      await expect(
        connectionService.recordDomainProofAbsent({
          tenantId: "org_beta",
          organizationId: "org_beta",
          connectionId: "ssoc_attested",
          commandId: "ssocmd_absent",
          occurredAtMs: clock,
          actor: { type: "system", id: null },
          source: "self-serve",
          domain: "beta.example",
          graceMs: SSO_DNS_REPROOF_GRACE_MS,
        }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });

      const attested = await connections.tryFindConnection({ connectionId: "ssoc_attested" });
      expect(attested?.domainVerifications[0]?.proofState).toBe("VERIFIED");
    });
  });

  describe("given the file proved the domain", () => {
    beforeEach(() => {
      seedProvedConnection("https-file");
      targets.targets = [
        {
          connectionId: CONNECTION,
          organizationId: ORG,
          domain: "acme.com",
          tokenHash: TOKEN_HASH,
          method: "https-file",
        },
      ];
    });

    /** @scenario "A domain the file proved is re-read at its file, not at DNS" */
    it("fetches the well-known address, never asks DNS, and records nothing while it is served", async () => {
      await reproof.sweep();

      expect(fileReads.asked).toEqual(["https://acme.com/.well-known/langwatch-verification.txt"]);
      expect(proofs.asked).toEqual([]);
      expect(recorded()).toEqual([]);
    });

    /** @scenario "A file that has gone missing starts the same clock a missing record does" */
    it("wavers the proof with the same deadline when the file answers without our token", async () => {
      fileReads.answer = { outcome: "absent" };

      await reproof.sweep();

      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });

    it("treats an unreachable origin as no answer at all", async () => {
      fileReads.answer = { outcome: "unreachable", reason: "timeout" };

      const outcome = await reproof.sweep();

      expect(outcome.unreachable).toBe(1);
      expect(recorded()).toEqual([]);
    });
  });

  describe("given one domain's re-read fails outright", () => {
    /** @scenario "One domain's failure does not abandon the domains after it" */
    it("carries the failure out and re-reads every other domain anyway", async () => {
      targets.targets = [
        {
          connectionId: "ssoc_missing",
          organizationId: "org_gone",
          domain: "gone.example",
          tokenHash: TOKEN_HASH,
          method: "dns-txt",
        },
        ...targets.targets,
      ];
      proofs.answer = { outcome: "absent" };

      const outcome = await reproof.sweep();

      expect(outcome.failed).toEqual([{ domain: "gone.example", error: expect.anything() }]);
      expect(outcome.wavered).toBe(1);
      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });
  });

  describe("given the sweep has run", () => {
    /** @scenario "A domain whose re-read failed goes to the back of the queue like any other" */
    it("stamps the look even for the domain whose re-read threw", async () => {
      targets.targets = [
        {
          connectionId: "ssoc_missing",
          organizationId: "org_gone",
          domain: "gone.example",
          tokenHash: TOKEN_HASH,
          method: "dns-txt",
        },
        ...targets.targets,
      ];

      const outcome = await reproof.sweep();

      expect(outcome.failed.map((failure) => failure.domain)).toEqual(["gone.example"]);
      expect(targets.swept).toEqual([["ssoc_missing", CONNECTION]]);
    });

    /** @scenario "A sweep that filled its batch says so rather than reading as complete" */
    it("reports a full batch as truncated and a short one as complete", async () => {
      const short = await reproof.sweep();
      expect(short.truncated).toBe(false);

      targets.targets = Array.from({ length: SSO_DOMAIN_REPROOF_BATCH }, () => ({
        connectionId: CONNECTION,
        organizationId: ORG,
        domain: "acme.com",
        tokenHash: TOKEN_HASH,
        method: "dns-txt" as const,
      }));

      const full = await reproof.sweep();

      expect(full.truncated).toBe(true);
    });

    /** @scenario "The history says the system looked, and names no person" */
    it("attributes the re-read to the system and to nobody in particular", async () => {
      proofs.answer = { outcome: "absent" };

      await reproof.sweep();

      expect(recorded()).toEqual(["domain_proof_wavered"]);
      expect(committed[0]?.command.data.actor).toEqual({ type: "system", id: null });
    });

    /** @scenario "Two re-reads of one domain are two observations, not one repeated" */
    it("gives two checks of one domain two command identities", async () => {
      proofs.answer = { outcome: "absent" };
      await reproof.sweep();

      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + HOUR_MS;
      await reproof.sweep();

      expect(recorded()).toEqual(["domain_proof_wavered", "domain_proof_lapsed"]);
      const [first, second] = committed.map((entry) => entry.command.data.commandId);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first).not.toBe(second);
    });
  });
});

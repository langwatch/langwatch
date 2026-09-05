import {
  domainProofFor,
  domainVouchesForNewPeople,
  emptySsoConnection,
  SSO_DNS_REPROOF_GRACE_MS,
  ssoDnsRecordName,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../crypto/pkce";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import {
  SsoDomainReproofService,
  type SsoDomainReproofNotifier,
  type SsoDomainReproofTarget,
  type SsoDomainReproofTargetRepository,
} from "../sso-domain-reproof.service";
import type {
  SsoDomainFileFetch,
  SsoDomainFileLookup,
  SsoDomainProofLookup,
  SsoDomainTxtLookup,
} from "../sso-self-serve.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

/**
 * Re-reading the records that prove domains (ADR-123).
 *
 * Integration because the answer is the composition: the sweep decides
 * whether to command at all, the guards decide whether the command states a
 * fact, and the fold decides what the connection then is. The resolver and
 * the mailer are the only seams; every decision above them is production
 * code.
 */

const ORG = "org_acme";
const CONNECTION = "ssoc_acme";
const ANA = { type: "user" as const, id: "user_ana" };
const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const TOKEN = "lw-verification-token-acme";
const TOKEN_HASH = `sha256:${sha256Hex(TOKEN)}`;

class StubProofs implements SsoDomainProofLookup {
  answer: SsoDomainTxtLookup = { outcome: "published", values: [TOKEN] };
  asked: string[] = [];

  async lookupTxtValues({ name }: { name: string }): Promise<SsoDomainTxtLookup> {
    this.asked.push(name);
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

  async markSwept({
    connectionIds,
  }: {
    connectionIds: readonly string[];
    atMs: number;
  }): Promise<void> {
    this.swept.push([...connectionIds]);
  }
}

/** The file channel's re-read seam, for a domain the file proved. */
class StubFileReads implements SsoDomainFileLookup {
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

class StubNotifier implements SsoDomainReproofNotifier {
  waverings: { domain: string; graceEndsAtMs: number }[] = [];
  lapses: { domain: string }[] = [];

  async wavering({
    domain,
    graceEndsAtMs,
  }: Parameters<SsoDomainReproofNotifier["wavering"]>[0]): Promise<void> {
    this.waverings.push({ domain, graceEndsAtMs });
  }

  async lapsed({
    domain,
  }: Parameters<SsoDomainReproofNotifier["lapsed"]>[0]): Promise<void> {
    this.lapses.push({ domain });
  }
}

let connections: InMemoryConnections;
let proofs: StubProofs;
let fileReads: StubFileReads;
let targets: StubTargets;
let notifier: StubNotifier;
let committed: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}[];
let clock: number;
let connectionService: SsoConnectionService;
let reproof: SsoDomainReproofService;

/** A live connection whose domain a published record proved, with the
 *  ceremony's hash carried forward — which is what makes it re-readable. */
function seedProvedConnection(): void {
  connections.seed({
    ...emptySsoConnection({ connectionId: CONNECTION }),
    organizationId: ORG,
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
    domainVerifications: [
      {
        domain: "acme.com",
        method: "dns-txt",
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
  notifier = new StubNotifier();
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
      return facts.map((fact) => ({
        ...fact,
        occurredAt: command.data.occurredAtMs,
      }));
    },
  };
  connectionService = new SsoConnectionService(
    new SsoConnectionGuards({
      connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([OLIVE.id]),
      licenseAuthority: new StubLicenseAuthority(false),
    }),
    ledger,
  );
  reproof = new SsoDomainReproofService({
    connections: () => connectionService,
    targets,
    proofs,
    files: fileReads,
    notifier,
    now: () => clock,
  });
  seedProvedConnection();
});

const held = () => connections.findConnection({ connectionId: CONNECTION });
const recorded = (): string[] =>
  committed
    .flatMap((entry) => entry.facts)
    .map((fact) => fact.type.replace("lw.identity.", ""));

describe("re-reading the record that proves a domain", () => {
  describe("given the record has gone missing", () => {
    beforeEach(() => {
      proofs.answer = { outcome: "absent" };
    });

    /** @scenario "A record that has gone missing starts a clock and changes nothing else" */
    it("wavers the proof, records the deadline, and leaves everything else exactly as it was", async () => {
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ checked: 1, wavered: 1, lapsed: 0 });
      expect(proofs.asked).toEqual([ssoDnsRecordName({ domain: "acme.com" })]);
      const state = await held();
      expect(domainProofFor({ state: state!, domain: "acme.com" })).toMatchObject(
        {
          proofState: "WAVERING",
          firstAbsentAtMs: T0,
          graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS,
          // What proved it is untouched: a waver is a statement about the
          // evidence's condition, never about who proved it or how.
          method: "dns-txt",
          actorId: ANA.id,
        },
      );
      // The connection is exactly as live as it was, and the domain still
      // routes and still vouches — a waver is a warning, not a punishment.
      expect(state?.state).toBe("ACTIVE");
      expect(state?.verifiedDomains).toEqual(["acme.com"]);
      expect(
        domainVouchesForNewPeople({ state: state!, domain: "acme.com" }),
      ).toBe(true);
      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });

    /** @scenario "The administrators are told when the record goes, and again when it is too late" */
    it("tells the administrators once, with the deadline, and again at the lapse", async () => {
      await reproof.sweep();
      expect(notifier.waverings).toEqual([
        { domain: "acme.com", graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS },
      ]);
      expect(notifier.lapses).toEqual([]);

      // A second look inside the window says nothing new, so nobody is
      // emailed a second time about a thing they already know.
      clock = T0 + HOUR_MS;
      await reproof.sweep();
      expect(notifier.waverings).toHaveLength(1);

      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + 1;
      await reproof.sweep();
      expect(notifier.lapses).toEqual([{ domain: "acme.com" }]);
    });

    /** @scenario "Forty-eight hours of continued absence is a lapse" */
    it("lapses only once the deadline has passed, and says how long it had been missing", async () => {
      await reproof.sweep();

      // An hour later, and a minute before the deadline: still missing, and
      // still nothing to say.
      clock = T0 + HOUR_MS;
      await reproof.sweep();
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS - 1;
      await reproof.sweep();
      expect(recorded()).toEqual(["domain_proof_wavered"]);
      expect(
        domainProofFor({ state: (await held())!, domain: "acme.com" })
          ?.proofState,
      ).toBe("WAVERING");

      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + 1;
      await reproof.sweep();
      expect(recorded()).toEqual([
        "domain_proof_wavered",
        "domain_proof_lapsed",
      ]);
      const lapse = committed
        .flatMap((entry) => entry.facts)
        .find((fact) => fact.type === "lw.identity.domain_proof_lapsed");
      expect(lapse?.data).toMatchObject({
        domain: "acme.com",
        firstAbsentAtMs: T0,
      });
    });

    /** @scenario "A lapse stops new people and stops nobody who is already here" */
    it("stops the domain vouching for anybody new while leaving the connection live", async () => {
      await reproof.sweep();
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + 1;
      await reproof.sweep();

      const state = await held();
      expect(
        domainProofFor({ state: state!, domain: "acme.com" })?.proofState,
      ).toBe("LAPSED");
      // The one behavioural difference.
      expect(
        domainVouchesForNewPeople({ state: state!, domain: "acme.com" }),
      ).toBe(false);
      // And the things that did NOT change, which is nearly everything: the
      // connection is live, the domain is still verified, and it still owns
      // the domain, so everybody already there signs in unchanged.
      expect(state?.state).toBe("ACTIVE");
      expect(state?.verifiedDomains).toEqual(["acme.com"]);
      expect(
        await connections.findDomainOwner({ domain: "acme.com" }),
      ).toMatchObject({ connectionId: CONNECTION });
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
      const state = await held();
      expect(domainProofFor({ state: state!, domain: "acme.com" })).toMatchObject(
        {
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
        },
      );
      expect(
        domainVouchesForNewPeople({ state: state!, domain: "acme.com" }),
      ).toBe(true);
      // Nothing was re-decided and nothing was re-issued: the whole remedy
      // was publishing the record again.
      expect(recorded()).toEqual([
        "domain_proof_wavered",
        "domain_proof_lapsed",
        "domain_proof_recovered",
      ]);
      expect(state?.pendingVerification).toBeNull();
      expect(state?.domainClaims).toEqual([]);
    });
  });

  describe("given the lookup itself cannot be answered", () => {
    /** @scenario "A lookup that could not be answered starts nothing and advances nothing" */
    it("records nothing and never spends a customer's grace", async () => {
      // First, a genuine absence puts the domain into its window.
      proofs.answer = { outcome: "absent" };
      await reproof.sweep();
      expect(recorded()).toEqual(["domain_proof_wavered"]);

      // Now our resolver stops answering, and stays that way well past the
      // deadline. Nothing about the customer's DNS has been observed, so
      // nothing about their domain may be concluded.
      proofs.answer = { outcome: "unreachable", reason: "SERVFAIL" };
      clock = T0 + SSO_DNS_REPROOF_GRACE_MS + HOUR_MS;
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ unreachable: 1, lapsed: 0, wavered: 0 });
      expect(recorded()).toEqual(["domain_proof_wavered"]);
      expect(
        domainProofFor({ state: (await held())!, domain: "acme.com" })
          ?.proofState,
      ).toBe("WAVERING");
      expect(notifier.lapses).toEqual([]);
    });

    it("starts no clock at all on a healthy domain", async () => {
      proofs.answer = { outcome: "unreachable", reason: "ETIMEOUT" };
      const outcome = await reproof.sweep();

      expect(outcome).toMatchObject({ unreachable: 1, wavered: 0 });
      expect(recorded()).toEqual([]);
      expect(
        domainProofFor({ state: (await held())!, domain: "acme.com" })
          ?.proofState,
      ).toBe("VERIFIED");
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
      expect(notifier.waverings).toEqual([]);
    });

    it("still records that it looked, so the next sweep moves on", async () => {
      // THIS IS WHY THE LOOK IS ITS OWN FACT. A healthy re-read writes no
      // history — the assertion above — so a sweep ordered by anything the
      // re-read writes re-reads the same connections forever. Worse, a
      // domain that STARTS wavering does write, which sorted the one domain
      // in its grace window to the back and out of the batch: the domain
      // that most needed re-checking was the one that stopped being
      // re-checked, so it never lapsed and kept vouching for new people.
      await reproof.sweep();

      expect(recorded()).toEqual([]);
      expect(targets.swept).toEqual([[CONNECTION]]);
    });

    it("is not fooled by somebody else's record at the same name", async () => {
      proofs.answer = {
        outcome: "published",
        values: ["v=spf1 include:example.com ~all", `${TOKEN}-not-quite`],
      };

      await reproof.sweep();

      // Not our token, so as far as the evidence goes the record is gone.
      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });
  });

  describe("given a domain no published record ever proved", () => {
    /** @scenario "A domain no published record ever proved is never doubted by DNS" */
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

      const attested = await connections.findConnection({
        connectionId: "ssoc_attested",
      });
      expect(
        domainProofFor({ state: attested!, domain: "beta.example" })?.proofState,
      ).toBe("VERIFIED");
    });
  });

  describe("given the file proved the domain", () => {
    beforeEach(() => {
      connections.seed({
        ...emptySsoConnection({ connectionId: CONNECTION }),
        organizationId: ORG,
        state: "ACTIVE",
        verifiedDomains: ["acme.com"],
        domainVerifications: [
          {
            domain: "acme.com",
            method: "https-file",
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
    it("fetches the well-known address, never asks DNS, and records nothing while the file is served", async () => {
      await reproof.sweep();

      expect(fileReads.asked).toEqual([
        "https://acme.com/.well-known/langwatch-verification.txt",
      ]);
      expect(proofs.asked).toEqual([]);
      expect(recorded()).toEqual([]);
    });

    /** @scenario "A file that has gone missing starts the same clock a missing record does" */
    it("wavers the proof with the same deadline when the file answers without our token", async () => {
      fileReads.answer = { outcome: "absent" };

      await reproof.sweep();

      expect(recorded()).toEqual(["domain_proof_wavered"]);
      expect(notifier.waverings).toEqual([
        { domain: "acme.com", graceEndsAtMs: T0 + SSO_DNS_REPROOF_GRACE_MS },
      ]);
    });

    it("treats an unreachable origin as no answer at all", async () => {
      fileReads.answer = { outcome: "unreachable", reason: "timeout" };

      const outcome = await reproof.sweep();

      expect(outcome.unreachable).toBe(1);
      expect(recorded()).toEqual([]);
    });
  });

  describe("given one domain's re-read fails outright", () => {
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

      expect(outcome.failed).toEqual([
        { domain: "gone.example", error: expect.anything() },
      ]);
      expect(outcome.wavered).toBe(1);
      expect(recorded()).toEqual(["domain_proof_wavered"]);
    });
  });
});

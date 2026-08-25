import {
  SSO_DNS_RECORD_NAME,
  SSO_DNS_RECORD_TYPE,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
  type SsoSelfServeContext,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import type {
  SelfServeIssuedDnsRecord,
  SsoDomainProofLookup,
  SsoDomainTxtLookup,
  SsoLicenseProofPort,
  SsoSelfServeContextPort,
} from "../sso-self-serve.service";
import { SsoSelfServeService } from "../sso-self-serve.service";
import type { SsoCredentialStore } from "../sso-credential-store";
import type { SsoIssuerDiscoveryPort } from "../sso-idp-registration";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";
import {
  StubBreakGlassReads,
  StubMembers,
  StubRouting,
  StubTestSignIns,
} from "./support/in-memory-self-serve";

/**
 * D05 tier 3's DNS leg (specs/identity/sso-domain-verification.feature): the
 * record a customer is given, the three things a lookup can answer, and what
 * each one does — or does not do — to the ledger.
 *
 * Integration because the answer depends on the composition: the service
 * decides whether to command at all, the guards decide whether the command
 * states a fact, and the fold decides what the connection then is. The
 * resolver is the only seam; everything above it is production code.
 */

const ORG = "org_acme";
const OTHER_ORG = "org_first";
let CONNECTION = "ssoc_acme";
const ANA = { userId: "user_ana" };
const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;

const HOSTED_OPTED_IN: SsoSelfServeContext = {
  deployment: "hosted",
  licensed: false,
  licenseActivatedSinceStart: false,
  optedIn: true,
};

class StubContext implements SsoSelfServeContextPort {
  async resolve(): Promise<SsoSelfServeContext> {
    return HOSTED_OPTED_IN;
  }
}

/** The vault and the network, stubbed: neither is what this file is about. */
class StubCredentials implements SsoCredentialStore {
  private readonly held = new Map<string, string>();

  async put({
    kind,
    value,
  }: Parameters<SsoCredentialStore["put"]>[0]): Promise<string> {
    const ref = `cred_${kind}_${this.held.size}`;
    this.held.set(ref, value);
    return ref;
  }

  async read({
    ref,
  }: Parameters<SsoCredentialStore["read"]>[0]): Promise<string | null> {
    return this.held.get(ref) ?? null;
  }
}

class StubDiscovery implements SsoIssuerDiscoveryPort {
  async discover(): Promise<{ reachable: true }> {
    return { reachable: true };
  }
}

class StubLicenseProof implements SsoLicenseProofPort {
  async currentLicenseKey(): Promise<string | null> {
    return null;
  }
}

/** The resolver seam, with all three answers it can give. */
class StubProofs implements SsoDomainProofLookup {
  published: string[] = [];
  unreachable: string | null = null;
  asked: { domain: string; name: string }[] = [];

  async lookupTxtValues({
    domain,
    name,
  }: {
    domain: string;
    name: string;
  }): Promise<SsoDomainTxtLookup> {
    this.asked.push({ domain, name });
    if (this.unreachable !== null) {
      return { outcome: "unreachable", reason: this.unreachable };
    }
    if (this.published.length === 0) return { outcome: "absent" };
    return { outcome: "published", values: this.published };
  }
}

let connections: InMemoryConnections;
let proofs: StubProofs;
let committed: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}[];
let clock: number;
let connectionService: SsoConnectionService;
let selfServe: SsoSelfServeService;

beforeEach(() => {
  connections = new InMemoryConnections();
  proofs = new StubProofs();
  committed = [];
  clock = T0;
  CONNECTION = "ssoc_acme";
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      committed.push({ command, facts });
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
  selfServe = new SsoSelfServeService({
    connections: () => connectionService,
    reads: connections,
    context: new StubContext(),
    proofs,
    license: new StubLicenseProof(),
    credentials: new StubCredentials(),
    discovery: new StubDiscovery(),
    baseUrl: "https://app.langwatch.test",
    // The seams going live grew (wave 3), at their quietest: nothing has
    // signed in, nobody holds a way back in, and the rollout has reached
    // nobody. Nothing in this file is about any of them.
    testSignIns: new StubTestSignIns(),
    breakGlass: new StubBreakGlassReads(),
    members: new StubMembers(),
    routing: new StubRouting(false),
    now: () => clock,
  });
});

/** Every fact the journey recorded, in order. */
const recorded = (): string[] =>
  committed
    .flatMap((entry) => entry.facts)
    .map((fact) => fact.type.replace("lw.identity.", ""));

const held = () => connections.findConnection({ connectionId: CONNECTION });

const check = () =>
  selfServe.checkDomainRecord({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain: "acme.com",
    actor: ANA,
  });

/** The refusal a check produced — and a failure if it produced none. */
async function refusalFrom(
  attempt: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  const caught = await attempt.then(
    () => null,
    (error: unknown) => error as { code: string; message: string },
  );
  if (caught === null) throw new Error("the check was expected to be refused");
  return caught;
}

/**
 * Register, claim, and take the record — the whole of what a hosted customer
 * does before publishing anything. No operator approves the claim, because
 * the record is what decides it.
 */
async function issuedRecord(): Promise<SelfServeIssuedDnsRecord> {
  const { connectionId } = await selfServe.registerConnection({
    organizationId: ORG,
    providerId: "okta",
    allowsJit: false,
    idp: {
      protocol: "oidc",
      issuer: "https://login.acme.okta.com",
      clientId: "client_acme",
      clientSecret: "secret_acme",
    },
    actor: ANA,
  });
  CONNECTION = connectionId;
  await selfServe.claimDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain: "acme.com",
    actor: ANA,
  });
  const issued = await selfServe.proveDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain: "acme.com",
    actor: ANA,
  });
  if (issued.proved) throw new Error("hosted setup must issue a record");
  return issued.record;
}

describe("proving a domain by publishing a record", () => {
  describe("given a record has been issued for a claim nobody has decided", () => {
    describe("when the setup surface is opened again", () => {
      /** @scenario "The value is shown when it is minted and never read back afterwards" */
      it("keeps showing where the record goes, and never the value a second time", async () => {
        const issued = await issuedRecord();

        // Everything a DNS control panel asks for, at the moment it is
        // issued: the kind of record, the whole name, and the label for a
        // provider that wants one relative to the zone.
        expect(issued).toMatchObject({
          domain: "acme.com",
          type: SSO_DNS_RECORD_TYPE,
          label: SSO_DNS_RECORD_NAME,
          name: `${SSO_DNS_RECORD_NAME}.acme.com`,
        });
        expect(issued.value.length).toBeGreaterThan(0);

        const view = await selfServe.getSetup({ organizationId: ORG });
        expect(view.record).toMatchObject({
          domain: "acme.com",
          type: SSO_DNS_RECORD_TYPE,
          label: SSO_DNS_RECORD_NAME,
          name: issued.name,
          expired: false,
        });
        // The value is minted once and only its hash is kept, so a reload
        // shows the record rather than the secret.
        expect(view.record?.value).toBeNull();
      });
    });

    describe("when the record is published and checked", () => {
      /** @scenario "The record is read before the domain is proved" */
      it("reads the name it asked the customer for, then states the proved fact", async () => {
        const issued = await issuedRecord();
        proofs.published = [issued.value];
        const before = recorded().length;

        await check();

        // The lookup asked for exactly the name the customer was told to
        // publish at — a ceremony where those disagree can never finish.
        expect(proofs.asked).toEqual([
          { domain: "acme.com", name: issued.name },
        ]);
        const state = await held();
        expect(state?.state).toBe("VERIFIED");
        expect(state?.verifiedDomains).toEqual(["acme.com"]);
        // The claim is decided and the domain proved by that one act, in
        // that order — the approval can never precede what proved it.
        expect(recorded().slice(before)).toEqual([
          "domain_claim_approved",
          "domain_verified",
        ]);
        expect(state?.domainClaims).toEqual([
          expect.objectContaining({ state: "APPROVED", authority: "dns-proof" }),
        ]);
        expect(state?.domainVerifications).toEqual([
          expect.objectContaining({ domain: "acme.com", method: "dns-txt" }),
        ]);
      });

      /** @scenario "Records published by other vendors on the same domain are not our token" */
      it("finds its own token among everybody else's records, and is not fooled by a near miss", async () => {
        const issued = await issuedRecord();
        proofs.published = [
          "v=spf1 include:example.com ~all",
          "google-site-verification=something-else",
          `${issued.value}-not-quite`,
        ];

        await expect(check()).rejects.toMatchObject({
          code: "sso_domain_proof_not_found",
        });
        expect((await held())?.verifiedDomains).toEqual([]);

        // The real one, sitting among the others, proves it.
        proofs.published = [...proofs.published, ` ${issued.value} `];
        await check();
        expect((await held())?.verifiedDomains).toEqual(["acme.com"]);
      });
    });

    describe("when the record is not published yet", () => {
      /** @scenario "A record that is not published yet is not a failed proof" */
      it("refuses by name and leaves the ceremony exactly where it was", async () => {
        const issued = await issuedRecord();
        const before = recorded();

        await expect(check()).rejects.toMatchObject({
          code: "sso_domain_proof_not_found",
        });

        // Nothing was commanded, so no history records an attempt that
        // proved nothing — and the record on screen is the same one.
        expect(recorded()).toEqual(before);
        expect((await held())?.pendingVerification).toMatchObject({
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: expect.stringContaining("sha256:"),
        });
        const view = await selfServe.getSetup({ organizationId: ORG });
        expect(view.record?.name).toBe(issued.name);
      });
    });

    describe("when the lookup itself cannot be answered", () => {
      /** @scenario "A lookup that could not happen says so, and blames nobody" */
      it("refuses with its own code rather than as a missing record, and records nothing", async () => {
        const issued = await issuedRecord();
        // The record IS published; the resolver is what will not answer.
        proofs.published = [issued.value];
        proofs.unreachable = "ESERVFAIL";
        const before = recorded();

        const refusal = await refusalFrom(check());

        expect(refusal.code).toBe("sso_domain_lookup_failed");
        expect(refusal.code).not.toBe("sso_domain_proof_not_found");
        expect(recorded()).toEqual(before);
        expect((await held())?.verifiedDomains).toEqual([]);

        // And the moment the resolver answers again, the same button
        // finishes: nothing about the ceremony was spent on the failure.
        proofs.unreachable = null;
        await check();
        expect((await held())?.verifiedDomains).toEqual(["acme.com"]);
      });
    });

    describe("when the ceremony passed its expiry before anybody checked", () => {
      /** @scenario "A ceremony that expired is re-proved through the same check" */
      it("re-proves through the same two verbs, without re-deciding the claim", async () => {
        const first = await issuedRecord();
        proofs.published = [first.value];
        clock = first.expiresAtMs + 1;

        await expect(check()).rejects.toMatchObject({
          code: "sso_domain_proof_expired",
        });

        // A fresh record against the same approved claim, published, and
        // checked through the very same mutation.
        const fresh = await selfServe.proveDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ANA,
        });
        if (fresh.proved) throw new Error("a fresh record must be issued");
        expect(fresh.record.value).not.toBe(first.value);
        expect(fresh.record.name).toBe(first.name);

        proofs.published = [fresh.record.value];
        await check();

        const state = await held();
        expect(state?.verifiedDomains).toEqual(["acme.com"]);
        // The claim was decided once. Re-proving never sent it back into the
        // queue, and never asked an operator anything a second time.
        expect(
          recorded().filter((type) => type === "domain_claim_approved"),
        ).toHaveLength(1);
        expect(recorded().filter((type) => type === "domain_claimed")).toHaveLength(
          1,
        );
      });
    });

    describe("when another organization proved the same domain while this one published", () => {
      /** @scenario "A domain another organization proved while this one waited is refused at the check" */
      it("refuses the check by name, tells the loser nothing about the winner, and proves nothing", async () => {
        const issued = await issuedRecord();
        // The ceremony is not instantaneous: somebody else went live on the
        // domain while this customer was waiting on their DNS team.
        connections.seed({
          connectionId: "ssoc_first",
          organizationId: OTHER_ORG,
          type: "oidc",
          state: "ACTIVE",
          claimedDomains: [],
          domainClaims: [],
          approvedDomains: [],
          verifiedDomains: ["acme.com"],
          domainVerifications: [],
          pendingVerification: null,
          idpMetadata: {
            issuer: null,
            providerId: "okta",
            clientIdRef: null,
            secretRef: null,
            certRefs: [],
          },
          allowsJit: false,
          source: "self-serve",
          testLoginAccountId: "acc_first",
          rejection: null,
          createdBy: "user_first",
          createdAtMs: T0,
          updatedAtMs: T0,
          tearDownAfterMs: null,
        });
        proofs.published = [issued.value];

        const refusal = await refusalFrom(check());

        expect(refusal.code).toBe("sso_connection_domain_taken");
        expect(refusal.message).not.toContain(OTHER_ORG);
        expect(refusal.message).not.toContain("user_first");
        expect((await held())?.verifiedDomains).toEqual([]);
      });
    });
  });
});

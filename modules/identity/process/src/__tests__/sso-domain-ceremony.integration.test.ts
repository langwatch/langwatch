import { HandledError } from "@langwatch/handled-error";
import {
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  SSO_DNS_PROOF_TTL_MS,
  SSO_DNS_RECORD_NAME,
  SSO_VERIFICATION_FILE_PATH,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  ssoDnsRecordName,
  ssoVerificationFileUrl,
  SsoConnectionNotFoundError,
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
  SsoConnectionRegistrationRepository,
  SsoConnectionRegistrationSlot,
} from "../repositories/sso-connection-registration.repository.ts";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "../repositories/sso-connection.repository.ts";
import { sha256Hex } from "../rules/pkce.rules.ts";
import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import { SsoDomainCeremonyService } from "../services/sso-domain-ceremony.service.ts";
import { licensingFixture, StubPlatformOperators } from "./support/in-memory-connections.ts";

/**
 * The self-serve domain ceremony (ADR-123, D05 tier 3). Integration because
 * the answer is the composition: the service reads, the guards decide whether
 * that states anything, the fold says what the connection now is.
 */

const ORG = "org_acme";
const OTHER_ORG = "org_globex";
const CONNECTION = "ssoc_acme";
const OTHER_CONNECTION = "ssoc_globex";
const ANA = { userId: "user_ana" };
const OPS_ID = "user_ops";
const T0 = 1_756_000_000_000;
const DOMAIN = "acme.com";

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [],
};

/** The guards' three reads, folded with the projection's own reducer so a
 *  guard can never pass against a state the projection never produces. */
class LocalConnections implements SsoConnectionReadRepository, SsoConnectionRegistrationRepository {
  /** One organization, one connection: nothing here competes for a slot. */
  async claim(candidate: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot> {
    return candidate;
  }

  private readonly states = new Map<string, SsoConnectionState>();

  async getConnection({ connectionId }: { connectionId: string }): Promise<SsoConnectionState> {
    const state = this.states.get(connectionId);
    if (!state) throw new SsoConnectionNotFoundError(connectionId);
    return state;
  }

  async getDomainOwner({
    domain,
  }: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string }> {
    for (const state of this.states.values()) {
      if (state.state === "ACTIVE" && state.verifiedDomains.includes(domain)) {
        return { connectionId: state.connectionId, organizationId: state.organizationId };
      }
    }

    throw new SsoConnectionNotFoundError(domain);
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionState[]> {
    return [...this.states.values()].filter((state) => state.organizationId === organizationId);
  }

  apply({
    connectionId,
    facts,
    occurredAt,
  }: {
    connectionId: string;
    facts: SsoConnectionFactInput[];
    occurredAt: number;
  }): void {
    let state = this.states.get(connectionId) ?? emptySsoConnection({ connectionId });
    for (const fact of facts) {
      state = reduceSsoConnection({ state, fact: { ...fact, occurredAt } });
    }
    this.states.set(connectionId, state);
  }

  seed(state: SsoConnectionState): void {
    this.states.set(state.connectionId, state);
  }
}

class LocalBreakGlass implements SsoBreakGlassBindingRepository {
  async hasLiveBinding(): Promise<boolean> {
    return true;
  }

  async reserveActivationRecovery(): Promise<boolean> {
    return true;
  }
}

class LocalStranding implements SsoConnectionStrandingRepository {
  async findStrandedUserIds(): Promise<string[]> {
    return [];
  }
}

class LocalProofs implements SsoDomainProofChannel {
  answer: SsoDomainTxtLookup = { outcome: "absent" };
  asked: string[] = [];

  async lookupTxtValues({ name }: { domain: string; name: string }): Promise<SsoDomainTxtLookup> {
    this.asked.push(name);

    return this.answer;
  }
}

class LocalFiles implements SsoDomainProofFileChannel {
  answer: SsoDomainFileFetch = { outcome: "absent" };
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

let connections: LocalConnections;
let proofs: LocalProofs;
let files: LocalFiles;
let stated: SsoConnectionFactInput[];
let clock: number;
let ceremony: SsoDomainCeremonyService;

/** The refusal's registered code, never its prose. */
async function codeOf(act: Promise<unknown>): Promise<string> {
  return act.then(
    () => "resolved",
    (error: unknown) => (error instanceof HandledError ? error.code : String(error)),
  );
}

function stateOf(connectionId = CONNECTION): Promise<SsoConnectionState | null> {
  return connections.getConnection({ connectionId });
}

/** A registered connection with one domain claimed, which is where the
 *  self-serve ceremony starts. */
async function reachRegistered(): Promise<void> {
  const identity = {
    tenantId: ORG,
    organizationId: ORG,
    connectionId: CONNECTION,
    commandId: "ssocmd_register",
    occurredAtMs: T0,
    actor: { type: "user" as const, id: ANA.userId },
    source: "self-serve" as const,
  };
  await connectionService.registerConnection({
    ...identity,
    type: "oidc",
    idp: IDP,
    arrivalPolicy: "admit",
  });
}

async function reachClaimed(): Promise<void> {
  await reachRegistered();
  await ceremony.claimDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain: DOMAIN,
    actor: ANA,
    proof: "dns-txt",
  });
}

/** Claim a domain, ask for its record, publish it and have it read. */
async function proveAndCheck(domain: string): Promise<void> {
  await ceremony.claimDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain,
    actor: ANA,
    proof: "dns-txt",
  });
  const issued = await ceremony.proveDomain({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain,
    actor: ANA,
    proof: "dns-txt",
  });
  proofs.answer = { outcome: "published", values: [issued.proved ? "" : issued.record.value] };
  await ceremony.checkDomainRecord({
    organizationId: ORG,
    connectionId: CONNECTION,
    domain,
    actor: ANA,
  });
}

/** Another organization already routes on the domain. */
function seedRivalOwner(): void {
  connections.seed({
    ...emptySsoConnection({ connectionId: OTHER_CONNECTION }),
    organizationId: OTHER_ORG,
    state: "ACTIVE",
    verifiedDomains: [DOMAIN],
    createdAtMs: T0,
    updatedAtMs: T0,
  });
}

let connectionService: SsoConnectionService;

/** The composition over one installation's licence answer. */
function compose(licensing: ReturnType<typeof licensingFixture>): void {
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      stated.push(...facts);
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
      breakGlass: new LocalBreakGlass(),
      stranding: new LocalStranding(),
      authorization: new StubPlatformOperators([OPS_ID]),
      licensing,
    }),
    ledger,
  );
  ceremony = SsoDomainCeremonyService.create({
    connections: () => connectionService,
    reads: connections,
    proofs,
    files,
    licensing,
    now: () => clock,
  });
}

beforeEach(() => {
  connections = new LocalConnections();
  proofs = new LocalProofs();
  files = new LocalFiles();
  stated = [];
  clock = T0;
  compose(licensingFixture());
});

describe("asking for a record", () => {
  /** @scenario "The value is shown when it is minted and never read back afterwards" */
  /** @scenario "The proof is recorded as a hash and the identity provider's secret is not recorded at all" */
  it("answers the value once and records only its hash", async () => {
    await reachClaimed();

    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });

    expect(issued.proved).toBe(false);
    if (issued.proved) return;
    expect(issued.record.name).toBe(ssoDnsRecordName({ domain: DOMAIN }));
    expect(issued.record.type).toBe("TXT");
    expect(issued.record.file.url).toBe(ssoVerificationFileUrl({ domain: DOMAIN }));
    expect(issued.record.expiresAtMs).toBe(T0 + SSO_DNS_PROOF_TTL_MS);

    const state = await stateOf();
    expect(state?.pendingVerification).toEqual({
      domain: DOMAIN,
      method: "dns-txt",
      tokenHash: `sha256:${sha256Hex(issued.record.value)}`,
      expiresAtMs: T0 + SSO_DNS_PROOF_TTL_MS,
    });
    expect(JSON.stringify(stated)).not.toContain(issued.record.value);
  });

  /** @scenario "A hosted administrator claims a domain and is given the record straight away" */
  it("hands the administrator the record with no review in the way, and routes nothing yet", async () => {
    await reachRegistered();

    const claim = await ceremony.claimDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });
    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });

    expect(claim).toEqual({ waitsForReview: false, disputed: false, verified: false });
    expect(issued.proved).toBe(false);
    if (issued.proved) return;
    expect(issued.record.name).toBe(ssoDnsRecordName({ domain: DOMAIN }));
    expect((await stateOf())?.verifiedDomains).toEqual([]);
  });
});

describe("what the record says about itself", () => {
  /** @scenario "The record names itself completely, so nothing has to be guessed" */
  it("gives the type, the whole name and the label without the domain, and a bare token", async () => {
    await reachClaimed();

    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });

    expect(issued.proved).toBe(false);
    if (issued.proved) return;
    expect(issued.record.type).toBe("TXT");
    expect(issued.record.label).toBe(SSO_DNS_RECORD_NAME);
    expect(issued.record.label).not.toContain(DOMAIN);
    expect(issued.record.name).toBe(`${issued.record.label}.${DOMAIN}`);
    expect(issued.record.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  /** @scenario "The administrator is offered the file channel beside the record" */
  it("offers the well-known path and the https address for the same value", async () => {
    await reachClaimed();

    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });

    expect(issued.proved).toBe(false);
    if (issued.proved) return;
    expect(issued.record.file.path).toBe(SSO_VERIFICATION_FILE_PATH);
    expect(issued.record.file.url).toBe(`https://${DOMAIN}${SSO_VERIFICATION_FILE_PATH}`);
  });
});

describe("checking what the domain publishes", () => {
  async function issue(): Promise<string> {
    await reachClaimed();
    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });

    return issued.proved ? "" : issued.record.value;
  }

  /** @scenario "One token satisfies either channel" */
  /** @scenario "A published record proves the domain, and a missing one says exactly that" */
  it("proves the domain from the record, and names the record as what proved it", async () => {
    const value = await issue();
    proofs.answer = { outcome: "published", values: [`  ${value}  `] };

    await expect(
      ceremony.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: DOMAIN,
        actor: ANA,
      }),
    ).resolves.toEqual({ proved: true });

    const state = await stateOf();
    expect(state?.verifiedDomains).toEqual([DOMAIN]);
    expect(state?.domainVerifications[0]?.method).toBe("dns-txt");
    expect(proofs.asked).toEqual([ssoDnsRecordName({ domain: DOMAIN })]);
    expect(files.asked).toEqual([]);
  });

  it("proves the same token from the file the domain serves", async () => {
    const value = await issue();
    files.answer = { outcome: "served", values: [value] };

    await expect(
      ceremony.checkDomainFile({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: DOMAIN,
        actor: ANA,
      }),
    ).resolves.toEqual({ proved: true });

    const state = await stateOf();
    expect(state?.domainVerifications[0]?.method).toBe("https-file");
    expect(files.asked).toEqual([ssoVerificationFileUrl({ domain: DOMAIN })]);
  });

  /** @scenario "A record that is not published yet is not a failed proof" */
  /** @scenario "A published record proves the domain, and a missing one says exactly that" */
  it("refuses a record that is not there, and leaves the ceremony where it was", async () => {
    await issue();
    const before = await stateOf();
    proofs.answer = { outcome: "absent" };

    expect(
      await codeOf(
        ceremony.checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_domain_proof_not_found");
    expect(await stateOf()).toEqual(before);
  });

  it("refuses somebody else's record published at our name", async () => {
    await issue();
    proofs.answer = { outcome: "published", values: ["google-site-verification=abc"] };

    expect(
      await codeOf(
        ceremony.checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_domain_proof_not_found");
  });

  /** @scenario "A lookup that could not happen says so, and blames nobody" */
  it("tells a lookup that failed apart from a record that is absent", async () => {
    await issue();
    proofs.answer = { outcome: "unreachable", reason: "SERVFAIL" };

    expect(
      await codeOf(
        ceremony.checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_domain_lookup_failed");
  });

  it("tells a fetch that failed apart from a file that is not served", async () => {
    await issue();
    files.answer = { outcome: "unreachable", reason: "ECONNREFUSED" };

    expect(
      await codeOf(
        ceremony.checkDomainFile({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_domain_lookup_failed");
  });

  it("refuses a check for a domain no record is outstanding for", async () => {
    await reachClaimed();

    expect(
      await codeOf(
        ceremony.checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_domain_proof_not_found");
    expect(proofs.asked).toEqual([]);
  });

  /** @scenario "A ceremony that expired is re-proved through the same check" */
  /** @scenario "An expired proof verifies nothing and a fresh one costs no progress" */
  it("re-proves an expired ceremony from a fresh record, deciding no claim twice", async () => {
    const stale = await issue();
    clock = T0 + SSO_DNS_PROOF_TTL_MS + 1;
    proofs.answer = { outcome: "published", values: [stale] };
    expect(
      await codeOf(
        ceremony.checkDomainRecord({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_domain_proof_expired");

    const reissued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });
    proofs.answer = {
      outcome: "published",
      values: [reissued.proved ? "" : reissued.record.value],
    };
    await expect(
      ceremony.checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: DOMAIN,
        actor: ANA,
      }),
    ).resolves.toEqual({ proved: true });

    const state = await stateOf();
    expect(state?.verifiedDomains).toEqual([DOMAIN]);
    expect(stated.filter((fact) => fact.type === DOMAIN_VERIFIED_EVENT_TYPE)).toHaveLength(1);
  });
});

describe("a domain somebody else proved while this claim waited", () => {
  /** @scenario "A domain another organization proved while this one waited is refused at the check" */
  it("refuses the check by code, names nobody and proves nothing", async () => {
    await reachClaimed();
    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });
    seedRivalOwner();
    proofs.answer = { outcome: "published", values: [issued.proved ? "" : issued.record.value] };

    const refusal = await ceremony
      .checkDomainRecord({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: DOMAIN,
        actor: ANA,
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({ code: "sso_connection_domain_taken" });
    const spoken = `${String(Reflect.get(Object(refusal), "message"))} ${JSON.stringify(
      Reflect.get(Object(refusal), "meta") ?? {},
    )}`;
    expect(spoken).not.toContain(OTHER_ORG);
    expect(spoken).not.toContain(OTHER_CONNECTION);
    expect((await stateOf())?.verifiedDomains).toEqual([]);
  });
});

describe("adding a domain to a live connection", () => {
  /** @scenario "Adding a domain never takes a live connection off the air" */
  it("keeps the connection ACTIVE through claim, proof and verification of the second domain", async () => {
    await reachRegistered();
    await proveAndCheck(DOMAIN);
    await connectionService.activateConnection({
      tenantId: ORG,
      organizationId: ORG,
      connectionId: CONNECTION,
      commandId: "ssocmd_activate",
      occurredAtMs: T0,
      actor: { type: "user", id: ANA.userId },
      source: "self-serve",
      testLoginAccountId: "acc_test",
    });
    expect((await stateOf())?.state).toBe("ACTIVE");

    await ceremony.claimDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.co.uk",
      actor: ANA,
      proof: "dns-txt",
    });
    expect((await stateOf())?.state).toBe("ACTIVE");

    const issued = await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.co.uk",
      actor: ANA,
      proof: "dns-txt",
    });
    expect((await stateOf())?.state).toBe("ACTIVE");

    proofs.answer = { outcome: "published", values: [issued.proved ? "" : issued.record.value] };
    await ceremony.checkDomainRecord({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.co.uk",
      actor: ANA,
    });

    const state = await stateOf();
    expect(state?.state).toBe("ACTIVE");
    expect(state?.verifiedDomains).toEqual([DOMAIN, "acme.co.uk"]);
  });
});

describe("a domain somebody else holds", () => {
  /** @scenario "A claim on a domain another organization proved waits for a person" */
  it("records the claim and says it waits for review, naming nobody", async () => {
    seedRivalOwner();

    await connectionService.registerConnection({
      tenantId: ORG,
      organizationId: ORG,
      connectionId: CONNECTION,
      commandId: "ssocmd_register",
      occurredAtMs: T0,
      actor: { type: "user", id: ANA.userId },
      source: "self-serve",
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "admit",
    });

    const outcome = await ceremony.claimDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });

    expect(outcome).toEqual({ waitsForReview: true, disputed: true, verified: false });
    expect((await stateOf())?.claimedDomains).toEqual([DOMAIN]);
  });

  /** @scenario "A disputed claim is the one that cannot be proved yet" */
  it("refuses to issue a record while that claim is undecided", async () => {
    seedRivalOwner();
    await reachClaimed();

    expect(
      await codeOf(
        ceremony.proveDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
          proof: "dns-txt",
        }),
      ),
    ).toBe("sso_domain_claim_pending");
  });
});

describe("taking a domain back out", () => {
  /** @scenario "A domain is taken back out of the connection" */
  it("takes the domain and its whole ceremony with it, and falls back a state", async () => {
    await reachClaimed();
    await ceremony.proveDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
      proof: "dns-txt",
    });
    expect((await stateOf())?.state).toBe("VERIFICATION_PENDING");

    await ceremony.removeDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: DOMAIN,
      actor: ANA,
    });

    const state = await stateOf();
    expect(state?.claimedDomains).toEqual([]);
    expect(state?.pendingVerification).toBeNull();
    expect(state?.verifiedDomains).toEqual([]);
    expect(state?.state).toBe("DRAFT");
    expect(stated.map((fact) => fact.type)).toContain(DOMAIN_WITHDRAWN_EVENT_TYPE);
  });

  it("leaves the connection on whatever its remaining domains earned", async () => {
    await reachRegistered();
    await proveAndCheck(DOMAIN);
    await ceremony.claimDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.co.uk",
      actor: ANA,
      proof: "dns-txt",
    });

    await ceremony.removeDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "acme.co.uk",
      actor: ANA,
    });

    const state = await stateOf();
    expect(state?.verifiedDomains).toEqual([DOMAIN]);
    expect(state?.state).toBe("VERIFIED");
  });

  /** @scenario "A verified domain cannot be removed from a connection that decides sign-in" */
  it("refuses a verified domain on a connection that decides sign-in", async () => {
    await reachRegistered();
    await proveAndCheck(DOMAIN);
    await connectionService.activateConnection({
      tenantId: ORG,
      organizationId: ORG,
      connectionId: CONNECTION,
      commandId: "ssocmd_activate",
      occurredAtMs: T0,
      actor: { type: "user", id: ANA.userId },
      source: "self-serve",
      testLoginAccountId: "acc_test",
    });

    expect(
      await codeOf(
        ceremony.removeDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
        }),
      ),
    ).toBe("sso_connection_invalid_transition");
    expect((await stateOf())?.verifiedDomains).toEqual([DOMAIN]);
  });

  it("refuses a domain that is not on the connection at all", async () => {
    await reachClaimed();

    expect(
      await codeOf(
        ceremony.removeDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: "never.example",
          actor: ANA,
        }),
      ),
    ).toBe("sso_connection_invalid_transition");
  });
});

describe("a connection the caller may not read", () => {
  it("refuses a foreign connection exactly as it refuses a missing one", async () => {
    await reachClaimed();

    expect(
      await codeOf(
        ceremony.claimDomain({
          organizationId: OTHER_ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
          proof: "dns-txt",
        }),
      ),
    ).toBe("sso_connection_not_found");
    expect(
      await codeOf(
        ceremony.claimDomain({
          organizationId: OTHER_ORG,
          connectionId: "ssoc_nothing",
          domain: DOMAIN,
          actor: ANA,
          proof: "dns-txt",
        }),
      ),
    ).toBe("sso_connection_not_found");
  });
});

describe("proving a domain with a self-hosted installation's licence", () => {
  const LICENSE_DIGEST = "sha256:installation-licence";
  const OPS = { userId: OPS_ID };

  const licensedInstallation = ({
    hostsSingleOrganization,
  }: {
    hostsSingleOrganization: boolean;
  }) =>
    compose(
      licensingFixture({
        authorizesDomainClaims: true,
        hostsSingleOrganization,
        licenseDigests: [LICENSE_DIGEST],
      }),
    );

  const claimWithLicense = (actor: { userId: string }) =>
    ceremony.claimDomain({
      organizationId: ORG,
      connectionId: CONNECTION,
      domain: "ACME.com",
      actor,
      proof: "license-token",
    });

  describe("given only one organization on the installation", () => {
    beforeEach(() => licensedInstallation({ hostsSingleOrganization: true }));

    /** @scenario "A self-hosted administrator sets single sign-on up with nobody else involved" */
    it("verifies the claimed domain at once, the claim approved on the licence's authority", async () => {
      await reachRegistered();

      await expect(claimWithLicense(ANA)).resolves.toEqual({
        waitsForReview: false,
        disputed: false,
        verified: true,
      });

      const state = await stateOf();
      expect(state?.state).toBe("VERIFIED");
      expect(state?.verifiedDomains).toEqual([DOMAIN]);
      expect(state?.domainClaims).toEqual([
        expect.objectContaining({ domain: DOMAIN, state: "APPROVED", authority: "license" }),
      ]);
      expect(state?.domainVerifications).toEqual([
        expect.objectContaining({
          domain: DOMAIN,
          method: "license-token",
          actorId: ANA.userId,
          tokenHash: null,
          evidenceRef: LICENSE_DIGEST,
        }),
      ]);
      // Nothing was looked up and no record was handed over.
      expect(proofs.asked).toEqual([]);
      expect(files.asked).toEqual([]);
      expect(stated.map((fact) => fact.type)).toEqual([
        CONNECTION_REGISTERED_EVENT_TYPE,
        DOMAIN_CLAIMED_EVENT_TYPE,
        VERIFICATION_REQUESTED_EVENT_TYPE,
        DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
        DOMAIN_VERIFIED_EVENT_TYPE,
      ]);
    });

    it("finishes a verification that stopped part way when the domain is proved again", async () => {
      await reachRegistered();
      await connectionService.claimDomain({
        tenantId: ORG,
        organizationId: ORG,
        connectionId: CONNECTION,
        commandId: "ssocmd_claim_only",
        occurredAtMs: T0,
        actor: { type: "user", id: ANA.userId },
        source: "self-serve",
        domain: DOMAIN,
      });

      await expect(
        ceremony.proveDomain({
          organizationId: ORG,
          connectionId: CONNECTION,
          domain: DOMAIN,
          actor: ANA,
          proof: "license-token",
        }),
      ).resolves.toEqual({ proved: true });
      expect((await stateOf())?.verifiedDomains).toEqual([DOMAIN]);
    });

    /** @scenario "A domain another organization on the installation holds is refused at claim time" */
    it("refuses a domain another organization holds before recording anything", async () => {
      seedRivalOwner();
      await reachRegistered();

      expect(await codeOf(claimWithLicense(ANA))).toBe("sso_connection_domain_taken");
      expect(stated.map((fact) => fact.type)).toEqual([CONNECTION_REGISTERED_EVENT_TYPE]);
      expect((await stateOf())?.domainClaims).toEqual([]);
    });
  });

  describe("given several organizations on the installation", () => {
    beforeEach(() => licensedInstallation({ hostsSingleOrganization: false }));

    /** @scenario "A platform operator's claim on a multi-organization installation is verified at once" */
    it("verifies a platform operator's claim at once with the licence as the proof", async () => {
      await reachRegistered();

      await expect(claimWithLicense(OPS)).resolves.toMatchObject({ verified: true });
      expect((await stateOf())?.domainVerifications).toEqual([
        expect.objectContaining({ method: "license-token", actorId: OPS_ID }),
      ]);
    });

    it("still refuses the licence to an administrator the surface mistook for an operator", async () => {
      await reachRegistered();

      expect(await codeOf(claimWithLicense(ANA))).toBe("sso_connection_operator_act_required");
      expect((await stateOf())?.verifiedDomains).toEqual([]);
    });

    /** @scenario "A licensed installation still needs domain-ownership evidence" */
    it("gives an organization administrator a record and file carrying one minted token", async () => {
      await reachClaimed();

      const issued = await ceremony.proveDomain({
        organizationId: ORG,
        connectionId: CONNECTION,
        domain: DOMAIN,
        actor: ANA,
        proof: "dns-txt",
      });

      expect(issued.proved).toBe(false);
      if (issued.proved) return;
      expect(issued.record.name).toBe(ssoDnsRecordName({ domain: DOMAIN }));
      expect(issued.record.file.url).toBe(ssoVerificationFileUrl({ domain: DOMAIN }));
      expect((await stateOf())?.pendingVerification?.tokenHash).toBe(
        `sha256:${sha256Hex(issued.record.value)}`,
      );
      expect((await stateOf())?.verifiedDomains).toEqual([]);
    });
  });
});

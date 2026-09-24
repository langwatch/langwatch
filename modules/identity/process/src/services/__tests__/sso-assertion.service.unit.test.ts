/**
 * @vitest-environment node
 * Whether an assertion may become a session — the check that runs BEFORE
 * anything links it to a person. The hole it pins is an account takeover.
 */
import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoConnectionNotFoundError,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerStub } = vi.hoisted(() => ({
  loggerStub: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));
vi.mock("@langwatch/observability", () => ({ createLogger: () => loggerStub }));

import {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
} from "../../repositories/sso-connection.repository.ts";
import { SsoAssertionService } from "../sso-assertion.service.ts";

/** Only the one read the gate makes; the other two are never reached here. */
class OneConnectionReads extends SsoConnectionReadRepository {
  constructor(readonly getConnection: SsoConnectionReadRepository["getConnection"]) {
    super();
  }

  getDomainOwner(): never {
    throw new Error("the gate never asks who owns a domain");
  }

  findForOrganization(): never {
    throw new Error("the gate never lists an organization's connections");
  }
}

class BreakGlassAnswering extends SsoBreakGlassBindingRepository {
  constructor(readonly hasLiveBinding: SsoBreakGlassBindingRepository["hasLiveBinding"]) {
    super();
  }

  reserveActivationRecovery(): never {
    throw new Error("the gate never reserves a way back in");
  }
}

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const REGISTRAR_ID = "user_ana";
const ORGANIZATION_ID = "org_acme";

const DOMAIN_PROOF: SsoDomainVerification = {
  domain: "acme.com",
  method: "dns-txt",
  actorId: null,
  verifiedAtMs: 1_756_000_000_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

function connection(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: CONNECTION_ID });
  return {
    ...base,
    organizationId: ORGANIZATION_ID,
    state: "ACTIVE",
    verifiedDomains: ["acme.com"],
    domainVerifications: [DOMAIN_PROOF],
    arrivalPolicy: "request",
    createdBy: REGISTRAR_ID,
    source: "self-serve",
    idpMetadata: { ...base.idpMetadata, providerId: "okta" },
    ...over,
  };
}

/**
 * A directory the registrant lookup is answered FROM, rather than a canned
 * row: a fake that answers the same way whatever it is asked cannot tell a
 * colleague's address from the registrar's, which is the whole subject here.
 */
function serviceOver({
  row,
  members = [],
  boundIdentities = [],
}: {
  row: SsoConnectionState | null;
  members?: { userId: string; address: string }[];
  boundIdentities?: { connectionId: string; accountId: string; address: string }[];
}) {
  const getConnection = vi.fn(async ({ connectionId }: { connectionId: string }) => {
    if (!row) throw new SsoConnectionNotFoundError(connectionId);
    return row;
  });
  const findRegistrantAtAddress = vi.fn(
    async ({ userId, email }: { userId: string; email: string }) =>
      members.some(
        (candidate) =>
          candidate.userId === userId && candidate.address === email.trim().toLowerCase(),
      ),
  );
  const findBoundMemberIdentity = vi.fn(
    async ({
      connectionId,
      accountId,
      email,
    }: {
      connectionId: string;
      accountId: string;
      email: string;
    }) =>
      boundIdentities.some(
        (candidate) =>
          candidate.connectionId === connectionId &&
          candidate.accountId === accountId &&
          candidate.address === email.trim().toLowerCase(),
      ),
  );
  const requestReproof = vi.fn<() => Promise<void>>().mockResolvedValue();

  return {
    service: SsoAssertionService.create({
      connections: new OneConnectionReads(getConnection),
      registrants: { findRegistrantAtAddress, findBoundMemberIdentity },
      reproof: { requestReproof },
    }),
    getConnection,
    findRegistrantAtAddress,
    findBoundMemberIdentity,
    requestReproof,
  };
}

/** The code a refusal answers with, or how it continued. */
const codeOf = (decision: Awaited<ReturnType<SsoAssertionService["decide"]>>) =>
  decision.action === "reject" ? decision.error.code : "continued";

const lapsedProof: SsoDomainVerification = { ...DOMAIN_PROOF, proofState: "LAPSED" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a live connection", () => {
  it("lets through an address on a domain it proved", async () => {
    const { service } = serviceOver({ row: connection() });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ).resolves.toEqual({ action: "continue" });
  });

  it("folds the asserted domain the way a claimed one is folded", async () => {
    const { service } = serviceOver({ row: connection() });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@ACME.com." }),
    ).resolves.toEqual({ action: "continue" });
  });

  it("accepts each exact proved domain and no subdomain of either", async () => {
    const beta = { ...DOMAIN_PROOF, domain: "beta.example" };
    const { service } = serviceOver({
      row: connection({
        verifiedDomains: ["acme.com", "beta.example"],
        domainVerifications: [DOMAIN_PROOF, beta],
      }),
    });

    for (const email of ["ana@acme.com", "bea@beta.example"]) {
      await expect(service.decide({ providerId: CONNECTION_ID, email })).resolves.toEqual({
        action: "continue",
      });
    }

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "attacker@sub.beta.example" }),
    ).resolves.toMatchObject({ action: "reject" });
  });

  it("keeps an exact previously bound member signing in after the proof lapses", async () => {
    const { service } = serviceOver({
      row: connection({ domainVerifications: [lapsedProof] }),
      boundIdentities: [
        { connectionId: CONNECTION_ID, accountId: "subject-ana", address: "ana@acme.com" },
      ],
    });

    await expect(
      service.decide({
        providerId: CONNECTION_ID,
        accountId: "subject-ana",
        email: "ana@acme.com",
      }),
    ).resolves.toEqual({ action: "continue" });
  });

  it("refuses an unknown subject after the proof lapses", async () => {
    const { service } = serviceOver({ row: connection({ domainVerifications: [lapsedProof] }) });

    await expect(
      service.decide({
        providerId: CONNECTION_ID,
        accountId: "subject-attacker",
        email: "ana@acme.com",
      }),
    ).resolves.toMatchObject({ action: "reject" });
  });

  it("keeps a grandfathered configured route compatible for existing sign-in", async () => {
    const base = emptySsoConnection({ connectionId: CONNECTION_ID });
    const { service } = serviceOver({
      row: connection({
        source: "legacy-grandfathered",
        domainVerifications: [],
        idpMetadata: { ...base.idpMetadata, providerId: "auth0" },
      }),
    });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ).resolves.toEqual({ action: "continue" });
  });

  describe("when it asserts an address on a domain it never proved", () => {
    it("refuses, whoever the address belongs to", async () => {
      const { service } = serviceOver({ row: connection() });

      await expect(
        service.decide({ providerId: CONNECTION_ID, email: "ceo@victim.test" }),
      ).resolves.toMatchObject({ action: "reject" });
    });

    it("refuses a subdomain of a domain it did prove", async () => {
      const { service } = serviceOver({ row: connection() });

      await expect(
        service.decide({ providerId: CONNECTION_ID, email: "ana@evil.acme.com" }),
      ).resolves.toMatchObject({ action: "reject" });
    });

    it("never asks whether the address belongs to a member", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({ row: connection() });

      await service.decide({ providerId: CONNECTION_ID, email: "ceo@victim.test" });

      // The registrant exemption belongs to connections that are not live.
      // A live connection asserting an unproved domain must not reach it.
      expect(findRegistrantAtAddress).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that is not live yet", () => {
  const underSetup = (over: Partial<SsoConnectionState> = {}) =>
    connection({ state: "DRAFT", verifiedDomains: [], domainVerifications: [], ...over });

  const directory = [
    { userId: REGISTRAR_ID, address: "ana@acme.com" },
    // A colleague in the SAME organization, who also works somewhere else.
    { userId: "user_bob", address: "bob@acme.com" },
  ];

  it("lets its own administrator through even though no domain is proved", async () => {
    const { service } = serviceOver({ row: underSetup(), members: directory });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ).resolves.toEqual({ action: "continue" });
  });

  it("refuses a colleague, though they are a member of the same organization", async () => {
    // Widening the exemption to any member hands an administrator holding
    // `sso:manage` a colleague's session — and with it that colleague's
    // access to every other organization, which the administrator never had.
    const { service } = serviceOver({ row: underSetup(), members: directory });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "bob@acme.com" }),
    ).resolves.toMatchObject({ action: "reject" });
  });

  it("narrows the registrant lookup by the registrar, not just the organization", async () => {
    const { service, findRegistrantAtAddress } = serviceOver({
      row: underSetup(),
      members: directory,
    });

    await service.decide({ providerId: CONNECTION_ID, email: "bob@acme.com" });

    expect(findRegistrantAtAddress).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      userId: REGISTRAR_ID,
      email: "bob@acme.com",
    });
  });

  it("refuses when nobody is recorded as having registered it", async () => {
    const { service, findRegistrantAtAddress } = serviceOver({
      row: underSetup({ createdBy: null }),
      members: directory,
    });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ).resolves.toMatchObject({ action: "reject" });
    expect(findRegistrantAtAddress).not.toHaveBeenCalled();
  });

  it("refuses an address belonging to nobody in its organization", async () => {
    const { service } = serviceOver({ row: underSetup(), members: directory });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ceo@victim.test" }),
    ).resolves.toMatchObject({ action: "reject" });
  });

  it("refuses even when that address is on a domain it has merely claimed", async () => {
    // Claiming is not proving. A claim is a sentence the customer typed.
    const { service } = serviceOver({
      row: underSetup({ state: "CLAIMED", claimedDomains: ["victim.test"] }),
      members: directory,
    });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ceo@victim.test" }),
    ).resolves.toMatchObject({ action: "reject" });
  });
});

describe("given an assertion that names no connection we hold", () => {
  it("refuses an id shaped like a connection that is not one", async () => {
    const { service } = serviceOver({ row: null });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ).resolves.toMatchObject({ action: "reject" });
  });

  it("refuses an id that is not a connection id at all, without a read", async () => {
    const { service, getConnection } = serviceOver({ row: connection() });

    await expect(
      service.decide({ providerId: "google", email: "ana@acme.com" }),
    ).resolves.toMatchObject({ action: "reject" });
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe("given a connection that no longer accepts sign-in", () => {
  const closed = ["REJECTED", "SUSPENDED", "TEARDOWN_PENDING", "TORN_DOWN"] as const;

  it.each(closed)("refuses a registrant callback while the connection is %s", async (state) => {
    const { service, findRegistrantAtAddress } = serviceOver({
      row: connection({ state }),
      members: [{ userId: REGISTRAR_ID, address: "ana@acme.com" }],
    });

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      email: "ana@acme.com",
    });

    expect(decision).toMatchObject({
      action: "reject",
      reason: "connection-not-accepting-sign-in",
    });
    expect(codeOf(decision)).toBe("sso_sign_in_refused");
    expect(findRegistrantAtAddress).not.toHaveBeenCalled();
  });

  // The fold keeps the proof, the arrival answer and the break-glass grant
  // through suspension and teardown, so a closed connection still satisfies
  // every readiness question. Readiness must not be what carries it.
  it.each(closed)("refuses a %s connection that is otherwise ready", async (state) => {
    const hasLiveBinding = vi.fn().mockResolvedValue(true);
    const service = SsoAssertionService.create({
      connections: new OneConnectionReads(async () =>
        connection({ state, arrivalPolicyDecidedAtMs: 1_756_000_000_000 }),
      ),
      registrants: {
        findRegistrantAtAddress: async () => false,
        findBoundMemberIdentity: async () => false,
      },
      breakGlass: new BreakGlassAnswering(hasLiveBinding),
    });

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      email: "newhire@acme.com",
    });

    expect(decision).toMatchObject({
      action: "reject",
      reason: "connection-not-accepting-sign-in",
    });
    // The state is an in-memory fact, so the door shut without a read.
    expect(hasLiveBinding).not.toHaveBeenCalled();
  });
});

describe("given an address the gate cannot read a domain from", () => {
  it.each([
    ["no address at all", null],
    ["an address with no at-sign", "anaacme.com"],
    ["an address with two at-signs", "a@b@acme.com"],
    ["an address ending at the at-sign", "ana@"],
  ])("refuses %s", async (_case, email) => {
    const { service } = serviceOver({ row: connection() });

    await expect(service.decide({ providerId: CONNECTION_ID, email })).resolves.toMatchObject({
      action: "reject",
    });
  });
});

describe("given several different reasons to refuse", () => {
  it("answers identically every cause that would say what exists here", async () => {
    const causes = await Promise.all([
      serviceOver({ row: null }).service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      }),
      serviceOver({ row: connection() }).service.decide({
        providerId: "google",
        email: "ana@acme.com",
      }),
      serviceOver({
        row: connection({ state: "DRAFT", createdBy: null }),
      }).service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ]);

    expect(new Set(causes.map(codeOf))).toEqual(new Set(["sso_sign_in_refused"]));
  });

  it("says the provider sent no address", async () => {
    const decision = await serviceOver({ row: connection() }).service.decide({
      providerId: CONNECTION_ID,
      email: null,
    });

    expect(codeOf(decision)).toBe("sso_assertion_without_address");
  });

  it("says the domain is not verified for this connection", async () => {
    const decision = await serviceOver({ row: connection() }).service.decide({
      providerId: CONNECTION_ID,
      email: "x@no.test",
    });

    expect(codeOf(decision)).toBe("sso_domain_not_verified");
  });

  it("says the address was not the registrant's, naming nobody", async () => {
    const decision = await serviceOver({
      row: connection({ state: "DRAFT", verifiedDomains: [], domainVerifications: [] }),
    }).service.decide({ providerId: CONNECTION_ID, email: "x@acme.com" });

    expect(codeOf(decision)).toBe("sso_setup_address_mismatch");
    expect(JSON.stringify(decision)).not.toContain(REGISTRAR_ID);
  });

  it("says the domain's verification has lapsed", async () => {
    const decision = await serviceOver({
      row: connection({ domainVerifications: [lapsedProof] }),
    }).service.decide({
      providerId: CONNECTION_ID,
      accountId: "subject-newcomer",
      email: "newhire@acme.com",
    });

    expect(codeOf(decision)).toBe("sso_domain_proof_lapsed");
  });

  it("never borrows the credential refusal's code", async () => {
    // `identity_sign_in_refused` means "that email or password is wrong", and
    // every one of these reached the gate without a password existing.
    const everyRefusal = await Promise.all([
      serviceOver({ row: null }).service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      }),
      serviceOver({ row: connection() }).service.decide({
        providerId: CONNECTION_ID,
        email: null,
      }),
      serviceOver({ row: connection() }).service.decide({
        providerId: CONNECTION_ID,
        email: "x@no.test",
      }),
      serviceOver({ row: connection({ state: "DRAFT", verifiedDomains: [] }) }).service.decide({
        providerId: CONNECTION_ID,
        email: "x@acme.com",
      }),
    ]);

    expect(everyRefusal.map(codeOf)).not.toContain("identity_sign_in_refused");
  });
});

describe("given any refusal at all", () => {
  it("writes down the reason, the connection and the domain", async () => {
    const { service } = serviceOver({
      row: connection({ state: "DRAFT", verifiedDomains: [], domainVerifications: [] }),
    });

    await service.decide({ providerId: CONNECTION_ID, email: "x@acme.com" });

    expect(loggerStub.info).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "setup-address-mismatch",
        providerId: CONNECTION_ID,
        organizationId: ORGANIZATION_ID,
        domain: "acme.com",
      }),
      expect.stringContaining("refused"),
    );
  });

  it("keeps the asserted address out of the line", async () => {
    const { service } = serviceOver({
      row: connection({ state: "DRAFT", verifiedDomains: [], domainVerifications: [] }),
    });

    await service.decide({ providerId: CONNECTION_ID, email: "someone@acme.com" });

    expect(JSON.stringify(loggerStub.info.mock.calls)).not.toContain("someone@acme.com");
  });

  it("logs a connection with no registrant at error, not as routine", async () => {
    const { service } = serviceOver({
      row: connection({ state: "DRAFT", verifiedDomains: [], createdBy: null }),
    });

    const decision = await service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" });

    expect(loggerStub.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "connection-has-no-registrant" }),
      expect.any(String),
    );
    expect(codeOf(decision)).toBe("sso_sign_in_refused");
  });
});

describe("given a domain whose published record has lapsed", () => {
  const lapsed = () => connection({ domainVerifications: [lapsedProof] });

  it("asks for that domain's record to be read again when it refuses somebody new", async () => {
    const { service, requestReproof } = serviceOver({ row: lapsed() });

    await service.decide({
      providerId: CONNECTION_ID,
      accountId: "subject-newcomer",
      email: "newhire@acme.com",
    });

    expect(requestReproof).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      domain: "acme.com",
    });
  });

  it("still refuses when the request itself fails", async () => {
    const { service, requestReproof } = serviceOver({ row: lapsed() });
    requestReproof.mockRejectedValue(new Error("outbox unavailable"));

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      accountId: "subject-newcomer",
      email: "newhire@acme.com",
    });

    expect(codeOf(decision)).toBe("sso_domain_proof_lapsed");
  });

  it("carries somebody already bound through, and asks for nothing", async () => {
    const { service, requestReproof } = serviceOver({
      row: lapsed(),
      boundIdentities: [
        { connectionId: CONNECTION_ID, accountId: "subject-known", address: "ana@acme.com" },
      ],
    });

    await expect(
      service.decide({
        providerId: CONNECTION_ID,
        accountId: "subject-known",
        email: "ana@acme.com",
      }),
    ).resolves.toEqual({ action: "continue" });
    expect(requestReproof).not.toHaveBeenCalled();
  });
});

/**
 * The deadlock: activation refuses without a real sign-in, and a connection
 * that was not ACTIVE accepted exactly one address — so an administrator
 * whose provider asserts anything else could never finish setup.
 */
describe("given a connection that has done everything but the sign-in", () => {
  const readyRow = (over: Partial<SsoConnectionState> = {}) =>
    connection({ state: "VERIFIED", arrivalPolicyDecidedAtMs: 1_756_000_000_000, ...over });

  function serviceWithBreakGlass({
    row,
    live = true,
  }: {
    row: SsoConnectionState;
    live?: boolean;
  }) {
    const hasLiveBinding = vi.fn().mockResolvedValue(live);
    return {
      service: SsoAssertionService.create({
        connections: new OneConnectionReads(async () => row),
        // Nobody: so anything carried through is carried by readiness and not
        // by the registrant exemption quietly matching.
        registrants: {
          findRegistrantAtAddress: async () => false,
          findBoundMemberIdentity: async () => false,
        },
        breakGlass: new BreakGlassAnswering(hasLiveBinding),
      }),
      hasLiveBinding,
    };
  }

  it("carries the sign-in that would activate it", async () => {
    const { service } = serviceWithBreakGlass({ row: readyRow() });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "newhire@acme.com" }),
    ).resolves.toEqual({ action: "continue" });
  });

  it("holds the door when nobody can get in without the identity provider", async () => {
    const { service } = serviceWithBreakGlass({ row: readyRow(), live: false });

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      email: "newhire@acme.com",
    });

    expect(codeOf(decision)).toBe("sso_setup_address_mismatch");
  });

  it("holds it when nobody has decided what an arrival gets, too", async () => {
    const { service } = serviceWithBreakGlass({
      row: readyRow({ arrivalPolicyDecidedAtMs: null }),
    });

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      email: "newhire@acme.com",
    });

    expect(codeOf(decision)).toBe("sso_setup_address_mismatch");
  });

  it("refuses an unproved domain however ready everything else is", async () => {
    const { service, hasLiveBinding } = serviceWithBreakGlass({
      row: readyRow({ verifiedDomains: [], domainVerifications: [] }),
    });

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      email: "newhire@acme.com",
    });

    expect(codeOf(decision)).toBe("sso_setup_address_mismatch");
    // And the cheap in-memory fact answered it, so nothing was read.
    expect(hasLiveBinding).not.toHaveBeenCalled();
  });
});

describe("given a connection that is already live", () => {
  it("asks the database no readiness question", async () => {
    // This runs on every single sign-on request, so an extra read here would
    // tax all of them for a rule that only matters before activation.
    const hasLiveBinding = vi.fn().mockResolvedValue(true);
    const service = SsoAssertionService.create({
      connections: new OneConnectionReads(async () => connection()),
      registrants: {
        findRegistrantAtAddress: async () => false,
        findBoundMemberIdentity: async () => false,
      },
      breakGlass: new BreakGlassAnswering(hasLiveBinding),
    });

    await expect(
      service.decide({ providerId: CONNECTION_ID, email: "ana@acme.com" }),
    ).resolves.toEqual({ action: "continue" });
    expect(hasLiveBinding).not.toHaveBeenCalled();
  });
});

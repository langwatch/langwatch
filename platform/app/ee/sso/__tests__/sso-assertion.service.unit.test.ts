import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The log the gate writes its reason to.
 *
 * Stubbed rather than ignored because WRITING IT DOWN IS HALF THE FEATURE.
 * Before this, several distinct causes shared one code and produced no server
 * log line at all, so the only record of which check had refused somebody was
 * a code in their address bar — and that code was the same for all of them.
 * Asserting on the line is the only way to keep that from happening again.
 */
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

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createLogger: () => loggerStub };
});

import {
  type SignInConnection,
  SsoAssertionService,
} from "../sso-assertion.service";

beforeEach(() => {
  loggerStub.info.mockClear();
  loggerStub.warn.mockClear();
  loggerStub.error.mockClear();
});

/**
 * Whether an assertion from a customer's identity provider may become a
 * session — the check that runs BEFORE better-auth links it to anybody.
 *
 * The hole this pins is an account takeover, and it needs three things that
 * were all true at once: `trustEmailVerified` hands "is this address real" to
 * the customer's own identity provider; account linking joins a verified
 * address to an existing user; and a connection is dialable from DRAFT, so it
 * needs no domain proof to be reachable. Register a connection, point it at a
 * server you control, assert somebody else's address, receive their session.
 *
 * So the cases below are written as an attacker would drive them, and the
 * assertions are about the DECISION rather than about a branch: the only
 * thing that matters is whether an assertion the connection has no right to
 * make is refused.
 */

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";

const REGISTRAR_ID = "user_ana";
const DOMAIN_PROOF = {
  domain: "acme.com",
  method: "dns-txt" as const,
  actorId: null,
  verifiedAtMs: 1_756_000_000_000,
  proofState: "VERIFIED" as const,
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
  evidenceRef: "sha256:proof",
  note: null,
  verifier: { type: "system" as const, id: "domain-proof-check" },
};

const connection = (
  over: Partial<SignInConnection> = {},
): SignInConnection => ({
  organizationId: "org_acme",
  state: "ACTIVE",
  verifiedDomains: ["acme.com"],
  domainVerifications: [DOMAIN_PROOF],
  lapsedDomains: [],
  arrivalPolicy: "request",
  createdBy: REGISTRAR_ID,
  source: "self-serve",
  providerId: "okta",
  ...over,
});

/**
 * A directory the membership lookup is answered FROM, rather than a canned
 * row. The gate narrows that lookup by `userId`, and a fake that answers the
 * same way whatever it is asked cannot tell a colleague's address from the
 * registrar's — which is the whole subject of the cases below.
 */
const serviceOver = ({
  row,
  members = [],
  boundIdentities = [],
}: {
  row: SignInConnection | null;
  members?: { userId: string; address: string }[];
  boundIdentities?: {
    connectionId: string;
    accountId: string;
    address: string;
  }[];
}) => {
  const findConnectionForSignIn = vi.fn().mockResolvedValue(row);
  const findRegistrantAtAddress = vi.fn(
    async ({ userId, email }: { userId: string; email: string }) =>
      members.some(
        (candidate) =>
          candidate.userId === userId &&
          candidate.address === email.trim().toLowerCase(),
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
  const requestReproof = vi.fn().mockResolvedValue(undefined);
  return {
    service: new SsoAssertionService({
      connections: { findConnectionForSignIn },
      memberships: { findRegistrantAtAddress, findBoundMemberIdentity },
      reproof: { requestReproof },
    }),
    findConnectionForSignIn,
    findRegistrantAtAddress,
    findBoundMemberIdentity,
    requestReproof,
  };
};

/** The code a refusal answers with, or how it continued. */
const codeOf = (
  decision: Awaited<ReturnType<SsoAssertionService["decide"]>>,
) => (decision.action === "reject" ? decision.error.code : "continued");

describe("given a live connection", () => {
  describe("when it asserts an address on a domain it proved", () => {
    it("lets the sign-in through", async () => {
      const { service } = serviceOver({ row: connection() });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });

    it("folds the asserted domain the way a claimed one is folded", async () => {
      const { service } = serviceOver({ row: connection() });
      // A trailing dot and a capital are the same domain. Comparing the raw
      // tail would make both of these a refusal for a legitimate employee.
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@ACME.com.",
        }),
      ).toEqual({ action: "continue" });
    });

    /** @scenario "Every exact domain on one connection is qualified independently" */
    it("accepts each exact proved domain and no subdomain of either", async () => {
      const betaProof = { ...DOMAIN_PROOF, domain: "beta.example" };
      const { service } = serviceOver({
        row: connection({
          verifiedDomains: ["acme.com", "beta.example"],
          domainVerifications: [DOMAIN_PROOF, betaProof],
        }),
      });

      for (const email of ["ana@acme.com", "bea@beta.example"]) {
        await expect(
          service.decide({ providerId: CONNECTION_ID, email }),
        ).resolves.toEqual({
          action: "continue",
        });
      }

      await expect(
        service.decide({
          providerId: CONNECTION_ID,
          email: "attacker@sub.beta.example",
        }),
      ).resolves.toMatchObject({ action: "reject" });
    });

    it("keeps an exact previously bound member signing in after ownership proof lapses", async () => {
      const { service } = serviceOver({
        row: connection({
          lapsedDomains: ["acme.com"],
          domainVerifications: [
            { ...DOMAIN_PROOF, proofState: "LAPSED" as const },
          ],
        }),
        boundIdentities: [
          {
            connectionId: CONNECTION_ID,
            accountId: "subject-ana",
            address: "ana@acme.com",
          },
        ],
      });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          accountId: "subject-ana",
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });

    it("refuses an unknown subject after ownership proof lapses", async () => {
      const { service } = serviceOver({
        row: connection({
          lapsedDomains: ["acme.com"],
          domainVerifications: [
            { ...DOMAIN_PROOF, proofState: "LAPSED" as const },
          ],
        }),
      });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          accountId: "subject-attacker",
          email: "ana@acme.com",
        }),
      ).toMatchObject({ action: "reject" });
    });

    it("keeps a grandfathered configured route compatible for existing sign-in", async () => {
      const { service } = serviceOver({
        row: connection({
          source: "legacy-grandfathered",
          providerId: "auth0",
          domainVerifications: [],
        }),
      });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });
  });

  describe("when it asserts an address on a domain it never proved", () => {
    /** @scenario "A provider may only assert addresses on the domains it proved" */
    it("refuses, whoever the address belongs to", async () => {
      const { service } = serviceOver({ row: connection() });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      expect(decision.action).toBe("reject");
    });

    it("refuses a subdomain of a domain it did prove", async () => {
      const { service } = serviceOver({ row: connection() });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@evil.acme.com",
      });
      expect(decision.action).toBe("reject");
    });

    it("never asks whether the address belongs to a member", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({
        row: connection(),
      });
      await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      // Membership is the setup journey's exception and belongs to connections
      // that are not live yet. A live connection asserting an unproved domain
      // must not be able to reach it by asserting a member's address.
      expect(findRegistrantAtAddress).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that is not live yet", () => {
  const underSetup = (over: Partial<SignInConnection> = {}) =>
    connection({ state: "DRAFT", verifiedDomains: [], ...over });

  const directory = [
    { userId: REGISTRAR_ID, address: "ana@acme.com" },
    // A colleague in the SAME organization, who also works somewhere else.
    { userId: "user_bob", address: "bob@acme.com" },
  ];

  describe("when its own administrator signs in to test it", () => {
    it("lets them through even though no domain is proved", async () => {
      // Activation refuses without a real sign-in through the connection, so
      // this path has to exist or a connection could never be activated.
      const { service } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });
  });

  describe("when it asserts a colleague's address instead of its own administrator's", () => {
    /** @scenario "A connection still being set up carries only its own people" */
    it("refuses, though the colleague is a member of the same organization", async () => {
      // The setup exemption is for ONE person: whoever registered the
      // connection. Widening it to any member hands an administrator who
      // holds `sso:manage` a colleague's session — and with it the
      // colleague's access to every other organization they belong to,
      // which the administrator never had.
      const { service } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "bob@acme.com",
      });
      expect(decision.action).toBe("reject");
    });

    it("narrows the membership lookup by the registrar, not just the organization", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      await service.decide({
        providerId: CONNECTION_ID,
        email: "bob@acme.com",
      });
      expect(findRegistrantAtAddress).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: REGISTRAR_ID,
        email: "bob@acme.com",
      });
    });
  });

  describe("when nobody is recorded as having registered it", () => {
    it("refuses, because there is no administrator to make an exception for", async () => {
      const { service, findRegistrantAtAddress } = serviceOver({
        row: underSetup({ createdBy: null }),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
      expect(findRegistrantAtAddress).not.toHaveBeenCalled();
    });
  });

  describe("when it asserts an address belonging to nobody in its organization", () => {
    it("refuses", async () => {
      const { service } = serviceOver({
        row: underSetup(),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      expect(decision.action).toBe("reject");
    });

    it("refuses even when that address is on a domain it has claimed", async () => {
      // Claiming is not proving. A claim is a sentence the customer typed.
      const { service } = serviceOver({
        row: underSetup({ state: "CLAIMED" }),
        members: directory,
      });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ceo@victim.test",
      });
      expect(decision.action).toBe("reject");
    });
  });
});

describe("given an assertion that names no connection we hold", () => {
  describe("when it reaches the gate", () => {
    /** @scenario "No such connection is held" */
    it("refuses an id that is shaped like a connection but is not one", async () => {
      const { service } = serviceOver({ row: null });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
    });

    /** @scenario "The named provider is not a connection at all" */
    it("refuses an id that is not a connection id at all", async () => {
      const { service, findConnectionForSignIn } = serviceOver({
        row: connection(),
      });
      const decision = await service.decide({
        providerId: "google",
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
      // Cheap first, and it matters: the deployment's own brokered provider
      // does not come through this plugin, so an id that is not a connection's
      // is anomalous rather than routine.
      expect(findConnectionForSignIn).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that no longer accepts sign-in", () => {
  /** @scenario "A callback for a suspended or removed connection is refused" */
  it.each([
    "REJECTED",
    "SUSPENDED",
    "TEARDOWN_PENDING",
    "TORN_DOWN",
  ])("refuses a registrant callback while the connection is %s", async (state) => {
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

  /**
   * The fold keeps the proof, the arrival decision and the break-glass grant
   * when a connection is suspended or torn down, so a closed connection still
   * answers every go-live readiness question. Readiness must not be what
   * carries it: an administrator who closed the door closed it on the
   * callback already in flight too.
   */
  /** @scenario "Go-live readiness does not survive suspension or teardown" */
  it.each([
    "REJECTED",
    "SUSPENDED",
    "TEARDOWN_PENDING",
    "TORN_DOWN",
  ])("refuses a %s connection that still satisfies every readiness condition", async (state) => {
    const breakGlassSpy = vi.fn().mockResolvedValue(true);
    const service = new SsoAssertionService({
      connections: {
        findConnectionForSignIn: async () =>
          connection({ state, arrivalPolicyDecidedAtMs: 1_756_000_000_000 }),
      },
      memberships: {
        findRegistrantAtAddress: async () => false,
        findBoundMemberIdentity: async () => false,
      },
      breakGlass: { hasLiveBreakGlass: breakGlassSpy },
    });

    const decision = await service.decide({
      providerId: CONNECTION_ID,
      email: "newhire@acme.com",
    });

    expect(decision).toMatchObject({
      action: "reject",
      reason: "connection-not-accepting-sign-in",
    });
    expect(codeOf(decision)).toBe("sso_sign_in_refused");
    // The state is an in-memory fact, so the door shut without a read.
    expect(breakGlassSpy).not.toHaveBeenCalled();
  });
});

describe("given an address the gate cannot read a domain from", () => {
  describe("when it reaches the gate", () => {
    it.each([
      ["no address at all", null],
      ["an address with no at-sign", "anaacme.com"],
      ["an address with two at-signs", "a@b@acme.com"],
      ["an address ending at the at-sign", "ana@"],
    ])("refuses %s", async (_case, email) => {
      const { service } = serviceOver({ row: connection() });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email,
      });
      expect(decision.action).toBe("reject");
    });
  });
});

describe("given several different reasons to refuse", () => {
  describe("when the cause would answer whether something exists here", () => {
    /** @scenario "A refusal about what exists here says nothing" */
    it("answers them identically, so no connection identifier is confirmed", async () => {
      const causes = await Promise.all([
        // A connection identifier we hold no row for.
        serviceOver({ row: null }).service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
        // Not a connection identifier at all.
        serviceOver({ row: connection() }).service.decide({
          providerId: "google",
          email: "ana@acme.com",
        }),
        // A connection recording nobody as having registered it. Ours to go
        // and fix, and never the caller's to hear about.
        serviceOver({
          row: connection({ state: "DRAFT", createdBy: null }),
        }).service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ]);

      // Distinguishing these would turn the gate into a way to find out which
      // connection identifiers are real.
      expect(new Set(causes.map(codeOf))).toEqual(
        new Set(["sso_sign_in_refused"]),
      );
    });
  });

  describe("when the cause is the caller's own assertion or configuration", () => {
    /** @scenario "The identity provider released no email address" */
    it("says the provider sent no address", async () => {
      // Authenticated successfully, released nothing to match on. The single
      // most common enterprise misconfiguration there is, and a fact about
      // their own assertion rather than anything of ours.
      expect(
        codeOf(
          await serviceOver({ row: connection() }).service.decide({
            providerId: CONNECTION_ID,
            email: null,
          }),
        ),
      ).toBe("sso_assertion_without_address");
    });

    /** @scenario "The asserted domain is not one the connection has proved" */
    it("says the domain is not verified for this connection", async () => {
      expect(
        codeOf(
          await serviceOver({ row: connection() }).service.decide({
            providerId: CONNECTION_ID,
            email: "x@no.test",
          }),
        ),
      ).toBe("sso_domain_not_verified");
    });

    /** @scenario "The provider asserted an address the connection cannot carry yet" */
    it("says the address was not the registrant's, naming nobody", async () => {
      // No `members`, so the directory answers nobody: this is somebody who
      // is not the registrant. The refusal names the address as the cause
      // rather than the connection's lifecycle — the reader is often the
      // administrator running the test that setup asked them for, and
      // "still being set up" tells them they may not do what they are being
      // told to do — while still naming no address and nobody.
      const decision = await serviceOver({
        row: connection({ state: "DRAFT" }),
      }).service.decide({
        providerId: CONNECTION_ID,
        email: "x@acme.com",
      });

      expect(codeOf(decision)).toBe("sso_setup_address_mismatch");
      // The registrant's identifier appears nowhere in what crosses back.
      expect(JSON.stringify(decision)).not.toContain(REGISTRAR_ID);
    });

    /** @scenario "The domain's proof has lapsed and this account is new" */
    it("says the domain's verification has lapsed", async () => {
      expect(
        codeOf(
          await serviceOver({
            row: connection({
              lapsedDomains: ["acme.com"],
              domainVerifications: [
                { ...DOMAIN_PROOF, proofState: "LAPSED" as const },
              ],
            }),
          }).service.decide({
            providerId: CONNECTION_ID,
            accountId: "subject-newcomer",
            email: "newhire@acme.com",
          }),
        ),
      ).toBe("sso_domain_proof_lapsed");
    });

    /** @scenario "The opaque refusal is not the credential refusal" */
    /** @scenario "No refusal at the door claims a password was wrong" */
    it("never borrows the credential refusal's code", async () => {
      // `identity_sign_in_refused` means "that email or password is wrong",
      // and every one of these reached the gate without a password existing.
      // It is also load-bearing on the credential screen, where it has to
      // keep meaning exactly one thing.
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
        serviceOver({ row: connection({ state: "DRAFT" }) }).service.decide({
          providerId: CONNECTION_ID,
          email: "x@acme.com",
        }),
      ]);

      expect(everyRefusal.map(codeOf)).not.toContain(
        "identity_sign_in_refused",
      );
    });
  });

  describe("when the reason is carried alongside the refusal", () => {
    it("names which of the checks refused, for the log to read", async () => {
      const { service } = serviceOver({ row: connection({ state: "DRAFT" }) });
      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "x@acme.com",
      });

      expect(decision).toMatchObject({
        action: "reject",
        reason: "setup-address-mismatch",
      });
    });
  });
});

describe("given any refusal at all", () => {
  describe("when it is made", () => {
    /** @scenario "Every refusal logs its reason" */
    it("writes down the reason, the connection and the domain", async () => {
      // The half that was missing entirely. Seven causes shared one code and
      // produced no log line, so which check had refused somebody existed
      // nowhere a reader could reach — the only copy was in an address bar.
      const { service } = serviceOver({ row: connection({ state: "DRAFT" }) });

      await service.decide({
        providerId: CONNECTION_ID,
        email: "x@acme.com",
      });

      expect(loggerStub.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "setup-address-mismatch",
          providerId: CONNECTION_ID,
          organizationId: "org_acme",
          domain: "acme.com",
        }),
        expect.stringContaining("refused"),
      );
    });

    it("keeps the asserted address out of the line", async () => {
      // Every one of the reasons is about the domain, the connection or the
      // organization, so the full address identifies no cause the domain does
      // not — and the addresses reaching this gate belong to people who may
      // have no account here at all.
      const { service } = serviceOver({ row: connection({ state: "DRAFT" }) });

      await service.decide({
        providerId: CONNECTION_ID,
        email: "someone@acme.com",
      });

      expect(JSON.stringify(loggerStub.info.mock.calls)).not.toContain(
        "someone@acme.com",
      );
    });

    /** @scenario "A connection with no registrant recorded is logged as our fault" */
    it("logs a connection with no registrant at error, not as routine", async () => {
      // OURS, not theirs. A row in this state should not exist: the customer
      // cannot act on it and is told nothing about it, but it is not a
      // refusal to shrug at either — it is one to go and fix.
      const { service } = serviceOver({
        row: connection({ state: "DRAFT", createdBy: null }),
      });

      const decision = await service.decide({
        providerId: CONNECTION_ID,
        email: "ana@acme.com",
      });

      expect(loggerStub.error).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "connection-has-no-registrant" }),
        expect.any(String),
      );
      // Loud for us, silent for them.
      expect(codeOf(decision)).toBe("sso_sign_in_refused");
    });
  });
});

describe("given a domain whose published record has lapsed", () => {
  const lapsed = () =>
    connection({
      lapsedDomains: ["acme.com"],
      domainVerifications: [{ ...DOMAIN_PROOF, proofState: "LAPSED" as const }],
    });

  describe("when somebody new is refused because of it", () => {
    /** @scenario "The gate asks for a re-read when it refuses somebody new" */
    it("asks for that domain's record to be read again", async () => {
      // The refusal is evidence somebody is being turned away right now,
      // which the eight-hourly sweep has no way to know — and the record is
      // very often simply back.
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
      // A refusal that could not ask for a re-proof is still a refusal. If
      // this threw, a 403 carrying words somebody can act on would become a
      // 500 carrying none.
      const { service, requestReproof } = serviceOver({ row: lapsed() });
      requestReproof.mockRejectedValue(new Error("outbox unavailable"));

      expect(
        codeOf(
          await service.decide({
            providerId: CONNECTION_ID,
            accountId: "subject-newcomer",
            email: "newhire@acme.com",
          }),
        ),
      ).toBe("sso_domain_proof_lapsed");
    });
  });

  describe("when somebody already bound to the connection signs in", () => {
    /** @scenario "Somebody already bound to the connection asks for nothing" */
    it("carries them through and asks for nothing", async () => {
      // ADR-123: a lapsed domain keeps signing in the people already there.
      // Nobody was turned away, so there is nothing to go and re-check.
      const { service, requestReproof } = serviceOver({
        row: lapsed(),
        boundIdentities: [
          {
            connectionId: CONNECTION_ID,
            accountId: "subject-known",
            address: "ana@acme.com",
          },
        ],
      });

      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          accountId: "subject-known",
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
      expect(requestReproof).not.toHaveBeenCalled();
    });
  });
});

/**
 * The deadlock: a connection that has done everything activation asks except
 * the sign-in currently being attempted
 * (specs/identity/sso-assertion-refusals.feature).
 *
 * Activation refuses without a real sign-in, and a connection that was not
 * ACTIVE accepted exactly one address — so an administrator whose provider
 * asserts anything other than their own LangWatch address could never finish
 * setup. Verifying the domain, which every screen told them to do, released
 * nothing: a proved domain was only consulted once the connection was live.
 */
describe("given a connection that has done everything but the sign-in", () => {
  /** Proved, arrivals decided — the row half of go-live readiness. */
  const readyRow = (over: Partial<SignInConnection> = {}) =>
    connection({
      state: "VERIFIED",
      arrivalPolicyDecidedAtMs: 1_756_000_000_000,
      ...over,
    });

  const serviceWithBreakGlass = ({
    row,
    hasLiveBreakGlass = true,
  }: {
    row: SignInConnection;
    hasLiveBreakGlass?: boolean;
  }) => {
    const breakGlassSpy = vi.fn().mockResolvedValue(hasLiveBreakGlass);
    return {
      service: new SsoAssertionService({
        connections: { findConnectionForSignIn: async () => row },
        memberships: {
          // Nobody: so anything carried through is carried by readiness and
          // not by the registrant exemption quietly matching.
          findRegistrantAtAddress: async () => false,
          findBoundMemberIdentity: async () => false,
        },
        breakGlass: { hasLiveBreakGlass: breakGlassSpy },
      }),
      breakGlassSpy,
    };
  };

  describe("when its identity provider asserts an address on the proved domain", () => {
    /** @scenario "A proved domain carries the sign-in that would activate it" */
    it("carries the sign-in through", async () => {
      const { service } = serviceWithBreakGlass({ row: readyRow() });

      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "newhire@acme.com",
        }),
      ).toEqual({ action: "continue" });
    });
  });

  describe("when nobody can get in without the identity provider", () => {
    /** @scenario "Missing any other precondition keeps the setup rule" */
    it("holds the door exactly as before", async () => {
      // The break-glass grant is what stops a connection admitting people it
      // could then strand.
      const { service } = serviceWithBreakGlass({
        row: readyRow(),
        hasLiveBreakGlass: false,
      });

      expect(
        codeOf(
          await service.decide({
            providerId: CONNECTION_ID,
            email: "newhire@acme.com",
          }),
        ),
      ).toBe("sso_setup_address_mismatch");
    });

    it("holds it when nobody has decided what an arrival gets, too", async () => {
      const { service } = serviceWithBreakGlass({
        row: readyRow({ arrivalPolicyDecidedAtMs: null }),
      });

      expect(
        codeOf(
          await service.decide({
            providerId: CONNECTION_ID,
            email: "newhire@acme.com",
          }),
        ),
      ).toBe("sso_setup_address_mismatch");
    });
  });

  describe("when the asserted domain was never proved", () => {
    /** @scenario "An unproved domain is never carried by readiness" */
    it("is refused however ready everything else is", async () => {
      // The proof is the entire basis for trusting the provider's word that
      // an address is real, so no amount of other readiness substitutes.
      const { service, breakGlassSpy } = serviceWithBreakGlass({
        row: readyRow({ verifiedDomains: [], domainVerifications: [] }),
      });

      expect(
        codeOf(
          await service.decide({
            providerId: CONNECTION_ID,
            email: "newhire@acme.com",
          }),
        ),
      ).toBe("sso_setup_address_mismatch");
      // And the cheap in-memory fact answered it, so nothing was read.
      expect(breakGlassSpy).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that is already live", () => {
  describe("when anybody signs in through it", () => {
    /** @scenario "A live connection asks nothing extra" */
    it("asks the database no readiness question", async () => {
      // This runs on every single sign-on request in the product, so an
      // extra read here would be a tax on all of them for a rule that only
      // matters before activation.
      const breakGlassSpy = vi.fn().mockResolvedValue(true);
      const service = new SsoAssertionService({
        connections: { findConnectionForSignIn: async () => connection() },
        memberships: {
          findRegistrantAtAddress: async () => false,
          findBoundMemberIdentity: async () => false,
        },
        breakGlass: { hasLiveBreakGlass: breakGlassSpy },
      });

      expect(
        await service.decide({
          providerId: CONNECTION_ID,
          email: "ana@acme.com",
        }),
      ).toEqual({ action: "continue" });
      expect(breakGlassSpy).not.toHaveBeenCalled();
    });
  });
});

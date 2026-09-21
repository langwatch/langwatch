import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIdentityMigrationFixture } from "~/server/app-layer/system-migrations/__tests__/identity-migration.fixture";

// The routine-versus-incident split below is a LOG LEVEL, so the logger is
// the seam it has to be observed at.
const log = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => log,
}));

import {
  type PendingSsoAdmission,
  type SsoArrivalGrantsPort,
  SsoArrivalService,
} from "../sso-arrival.service";
import type { SignInConnection } from "../sso-assertion.service";

/**
 * Whether the answer an administrator gave is the answer an arrival gets.
 *
 * The bug this pins is not a wrong answer, it is no answer: `arrivalPolicy`
 * was written, folded and rendered, and nothing on a sign-in path read it, so
 * every arrival through a self-serve connection got an account and nothing
 * else — no membership, no request, and an empty queue on the administrator's
 * screen. So each case asserts the CONSEQUENCE (a membership row, a request)
 * rather than that a branch was taken.
 */

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const USER = { id: "user_ana", email: "ana@acme.com", name: "Ana" };
const ORG = { id: "org_acme", name: "Acme" };
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
  organizationId: ORG.id,
  state: "ACTIVE",
  arrivalPolicy: "request",
  verifiedDomains: ["acme.com"],
  domainVerifications: [DOMAIN_PROOF],
  lapsedDomains: [],
  createdBy: "user_ana",
  source: "self-serve",
  providerId: "okta",
  ...over,
});

/** What the membership write answers, which is the seam three cases turn on. */
type MembershipWrite = () => Promise<"created" | "already-present">;

const serviceOver = ({
  row,
  member = false,
  pendingInvite = null,
  membership = async () => "created",
  pendingAdmission = null,
}: {
  row: SignInConnection | null;
  member?: boolean;
  pendingInvite?: { inviteId: string } | null;
  membership?: MembershipWrite;
  pendingAdmission?: PendingSsoAdmission | null;
}) => {
  const migrations = createIdentityMigrationFixture();
  const findMembership = vi.fn().mockResolvedValue(member);
  let pending = pendingAdmission;
  const createMembership = vi.fn(async () => {
    const outcome = await membership();
    if (outcome === "created") {
      findMembership.mockResolvedValue(true);
      pending = {
        grantId: "rb_admission",
        occurredAtMs: 1_756_000_000_000,
        state: "pending",
      };
    }
    return outcome;
  });
  const findPendingAdmission = vi.fn(async () => pending && { ...pending });
  const completeAdmission = vi.fn(async () => {
    if (!pending) return false;
    pending = null;
    return true;
  });
  const clearPendingAdmission = vi.fn(async () => {
    pending = null;
    return true;
  });
  const findConnectionForSignIn = vi.fn().mockResolvedValue(row);
  const requestFromSsoArrival = vi
    .fn()
    .mockResolvedValue({ joinRequestId: "jr_1" });
  const applyPendingInvite = vi.fn().mockResolvedValue(pendingInvite);
  const attachBindings = vi.fn<SsoArrivalGrantsPort["attachBindings"]>(
    async () => {
      if (pending) pending.state = "applied";
      return { attached: ["rb_admission"], duplicates: [] };
    },
  );
  const joinedAutomatically = vi.fn<() => Promise<void>>().mockResolvedValue();
  const announceSignup = vi.fn();
  const startNurturing = vi.fn();

  return {
    service: new SsoArrivalService({
      migrations: migrations.service,
      connections: { findConnectionForSignIn },
      memberships: {
        findMembership,
        createMembership,
        findPendingAdmission,
        completeAdmission,
        clearPendingAdmission,
        findOrganizationForMembership: vi.fn().mockResolvedValue(ORG),
      },
      invites: { applyPendingInvite },
      joinRequests: { requestFromSsoArrival },
      grants: { attachBindings },
      notifications: { joinedAutomatically, announceSignup, startNurturing },
    }),
    migrations,
    findMembership,
    findConnectionForSignIn,
    requestFromSsoArrival,
    applyPendingInvite,
    attachBindings,
    joinedAutomatically,
    announceSignup,
    startNurturing,
    createMembership,
    findPendingAdmission,
    completeAdmission,
    clearPendingAdmission,
  };
};

const admit = (
  parts: ReturnType<typeof serviceOver>,
  domain = "acme.com",
): Promise<void> =>
  parts.service.admit({ user: USER, connectionId: CONNECTION_ID, domain });

beforeEach(() => {
  vi.clearAllMocks();
  log.info.mockClear();
  log.error.mockClear();
});

describe("given somebody arriving through a live connection on a domain it proved", () => {
  describe("when the answer is that they ask and an administrator approves", () => {
    /** @scenario "An arrival on a connection that asks keeps the account and waits" */
    it("stands a request to join, and makes them no member", async () => {
      const parts = serviceOver({ row: connection() });

      await admit(parts);

      expect(parts.requestFromSsoArrival).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        domain: "acme.com",
      });
      expect(parts.createMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that they join automatically", () => {
    /** @scenario Authenticated user on a proved admitting SSO connection joins its organization */
    it("makes them a member and asks nobody", async () => {
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "admit" }),
      });

      await admit(parts);

      expect(parts.createMembership).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
      });
      // The grant, not just the row: a membership without one is "in the
      // org" to legacy code and zero access under RBAC.
      expect(parts.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_acme",
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: "user_ana" },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: "org_acme",
            }),
          ],
        }),
      );
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that nobody new gets in", () => {
    it("leaves them with the account and nothing else", async () => {
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "refuse" }),
      });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that must admit nobody new", () => {
  describe("when the domain's published record has lapsed", () => {
    /** ADR-123: a lapsed domain still routes, and stops provisioning. */
    it("admits nobody, though the connection is still live", async () => {
      const parts = serviceOver({
        row: connection({
          lapsedDomains: ["acme.com"],
          domainVerifications: [
            { ...DOMAIN_PROOF, proofState: "LAPSED" as const },
          ],
        }),
      });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when only a legacy configuration names the domain", () => {
    it("does not use that compatibility route as authority to admit anyone", async () => {
      const parts = serviceOver({
        row: connection({
          source: "legacy-grandfathered",
          providerId: "auth0",
          domainVerifications: [],
        }),
      });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the connection is not on yet", () => {
    it("admits nobody", async () => {
      const parts = serviceOver({ row: connection({ state: "VERIFIED" }) });

      await admit(parts);

      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the address is on a domain it never proved", () => {
    it("admits nobody", async () => {
      const parts = serviceOver({ row: connection() });

      await admit(parts, "elsewhere.com");

      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when they are already a member", () => {
    it("asks nothing, which is every administrator testing their own connection", async () => {
      const parts = serviceOver({ row: connection(), member: true });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given an account that is not a connection at all", () => {
  describe("when it reaches the arrival seam", () => {
    it("does not ask the database about it", async () => {
      const parts = serviceOver({ row: null });

      await parts.service.admit({
        user: USER,
        connectionId: "google",
        domain: "acme.com",
      });

      expect(parts.findConnectionForSignIn).not.toHaveBeenCalled();
    });
  });
});

/**
 * A member who later lacks access is nothing to go on unless the arrival
 * that admitted or declined them left a trace. `arrivalDecisionFor` returns
 * `null` silently on several distinct conditions; each one now logs once,
 * with a stable machine-readable `reason` so a later "why doesn't this
 * member have access" search has something to grep for. NO behaviour
 * change: every case below still asserts the decision stays declined.
 */
describe("given an arrival this connection was never going to admit", () => {
  const REASON_MESSAGE = "a single sign-on arrival was not considered for admission";

  describe("when the account id is not connection-shaped at all", () => {
    it("logs once with reason not_a_connection_id and admits nobody", async () => {
      const parts = serviceOver({ row: null });

      await parts.service.admit({
        user: USER,
        connectionId: "google",
        domain: "acme.com",
      });

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "not_a_connection_id",
          connectionId: "google",
        }),
        REASON_MESSAGE,
      );
      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the connection id looks right but does not resolve", () => {
    it("logs once with reason connection_not_found", async () => {
      const parts = serviceOver({ row: null });

      await admit(parts);

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "connection_not_found",
          connectionId: CONNECTION_ID,
        }),
        REASON_MESSAGE,
      );
      expect(parts.createMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the connection is not live yet", () => {
    it("logs once with reason domain_not_live", async () => {
      const parts = serviceOver({ row: connection({ state: "VERIFIED" }) });

      await admit(parts);

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "domain_not_live",
          connectionId: CONNECTION_ID,
          organizationId: ORG.id,
        }),
        REASON_MESSAGE,
      );
    });
  });

  describe("when the address is on a domain the connection never proved", () => {
    it("logs once with reason domain_not_proved", async () => {
      const parts = serviceOver({ row: connection() });

      await admit(parts, "elsewhere.com");

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "domain_not_proved",
          connectionId: CONNECTION_ID,
          organizationId: ORG.id,
        }),
        REASON_MESSAGE,
      );
    });
  });

  describe("when the domain's published record has lapsed", () => {
    it("logs once with reason domain_proof_lapsed", async () => {
      // `proved` and `lapsed` are checked in order, and a LAPSED proof state
      // fails `proved` first (see qualifySsoDomainOwnership) — so reaching
      // THIS reason needs the proof itself still VERIFIED while the
      // connection's separately-derived `lapsedDomains` set already lists
      // the domain, the state ADR-123 calls "still routes, stops
      // provisioning".
      const parts = serviceOver({
        row: connection({ lapsedDomains: ["acme.com"] }),
      });

      await admit(parts);

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "domain_proof_lapsed",
          connectionId: CONNECTION_ID,
          organizationId: ORG.id,
        }),
        REASON_MESSAGE,
      );
    });
  });
});

describe("given an arrival the join rules refuse for an ordinary reason", () => {
  describe("when the request is already in the queue", () => {
    it("swallows it, because the sign-in itself succeeded", async () => {
      const parts = serviceOver({ row: connection() });
      parts.requestFromSsoArrival.mockRejectedValue(
        Object.assign(new Error("already waiting"), {
          code: "join_request_already_pending",
        }),
      );

      await expect(admit(parts)).resolves.toBeUndefined();
    });
  });

  describe("when the membership write fails outright", () => {
    it("swallows it, because the account is already committed", async () => {
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "admit" }),
        membership: () => Promise.reject(new Error("db down")),
      });

      await expect(admit(parts)).resolves.toBeUndefined();
    });
  });
});

describe("given a domain-matched organization to join", () => {
  describe("when a pending invite is waiting for that address", () => {
    it("applies it and writes no default membership", async () => {
      const parts = serviceOver({
        row: connection(),
        pendingInvite: { inviteId: "inv_1" },
      });

      await parts.service.joinOrganization({
        user: USER,
        org: ORG,
        domain: "acme.com",
      });

      expect(parts.applyPendingInvite).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        email: "ana@acme.com",
      });
      // The invite's own role and team assignments carry their own grants,
      // so the default MEMBER pair must not run beside them.
      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.attachBindings).not.toHaveBeenCalled();
      expect(parts.joinedAutomatically).not.toHaveBeenCalled();
      expect(parts.announceSignup).toHaveBeenCalledWith({
        userName: "Ana",
        userEmail: "ana@acme.com",
        organizationName: "Acme",
      });
    });
  });

  describe("when no invite is waiting", () => {
    it("makes them a MEMBER, grants the organization scope and announces it", async () => {
      const parts = serviceOver({ row: connection() });

      await parts.service.joinOrganization({
        user: USER,
        org: ORG,
        domain: "acme.com",
      });

      expect(parts.createMembership).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
      });
      expect(parts.attachBindings).toHaveBeenCalledTimes(1);
      expect(parts.startNurturing).toHaveBeenCalledWith({
        userId: "user_ana",
        email: "ana@acme.com",
        name: "Ana",
        organizationId: "org_acme",
        organizationName: "Acme",
      });
    });
  });

  describe("when a concurrent callback already created the membership row", () => {
    it("re-asserts the organization grant instead of assuming it landed", async () => {
      // The membership row and the grant beside it no longer share a
      // transaction, so the other callback may have died between them. The
      // row being there says nothing about the grant.
      const parts = serviceOver({
        row: connection(),
        membership: async () => "already-present",
        pendingAdmission: {
          grantId: "rb_admission",
          occurredAtMs: 1_756_000_000_000,
          state: "pending",
        },
      });

      await parts.service.joinOrganization({
        user: USER,
        org: ORG,
        domain: "acme.com",
      });

      expect(parts.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_acme",
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: "user_ana" },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: "org_acme",
            }),
          ],
        }),
      );
      expect(parts.announceSignup).toHaveBeenCalledOnce();
    });
  });
});

/**
 * The sign-in has already succeeded and the account is already committed by
 * the time any of this runs, so nothing here may turn a working sign-in into
 * "unable to create user". What it may do is say so in the log — and say it
 * at the right volume, because an administrator whose queue is empty is told
 * to look for exactly one line.
 *
 * Spec: specs/identity/join-requests.feature, "A request nobody clicked".
 */
describe("given the queue will not take the request behind an arrival", () => {
  /** @scenario "A sign-in never fails because the queue would not take the request behind it" */
  it("leaves the sign-in succeeding rather than raising at the person signing in", async () => {
    const parts = serviceOver({ row: connection() });
    parts.requestFromSsoArrival.mockRejectedValue(
      Object.assign(new Error("already waiting"), {
        code: "join_request_already_pending",
      }),
    );

    // The assertion is that this RESOLVES. Throwing here surfaced as
    // "unable to create user" on a sign-in that had already worked.
    await expect(admit(parts)).resolves.toBeUndefined();
  });

  /** @scenario "An arrival already in the queue is recorded as routine, not as a failure" */
  it("files a duplicate as an ordinary outcome and a surprise as a failure", async () => {
    const routine = serviceOver({ row: connection() });
    routine.requestFromSsoArrival.mockRejectedValue(
      Object.assign(new Error("already waiting"), {
        code: "join_request_already_pending",
      }),
    );

    await admit(routine);

    // A fresh account row for somebody already waiting is a provider
    // rotation or an unlink — a sentence about the world, not an incident.
    expect(log.info).toHaveBeenCalledTimes(1);

    log.info.mockClear();
    log.error.mockClear();

    const surprise = serviceOver({ row: connection() });
    surprise.requestFromSsoArrival.mockRejectedValue(
      new Error("the database went away"),
    );

    await admit(surprise);

    // And the line an administrator greps for still gets written when
    // something genuinely went wrong.
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe("given somebody who already belongs to the organization", () => {
  /** @scenario "Somebody who is already a member is nothing to admit and nothing to ask about" */
  it("asks for nothing and writes nothing", async () => {
    // Every administrator testing their own connection arrives this way.
    const parts = serviceOver({ row: connection(), member: true });

    await admit(parts);

    expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    expect(parts.createMembership).not.toHaveBeenCalled();
  });
});

describe("administrator notices after automatic SSO admission", () => {
  for (const schedule of ["repeat", "concurrent"]) {
    /** @scenario "Repeated or concurrent SSO arrivals announce only the new membership" */
    it(`sends one notice for ${schedule} callbacks`, async () => {
      const members = new Set<string>();
      const parts = serviceOver({
        row: connection({ arrivalPolicy: "admit" }),
        membership: async () => {
          if (members.has(USER.id)) return "already-present";
          members.add(USER.id);
          return "created";
        },
      });

      if (schedule === "concurrent") {
        await Promise.all([admit(parts), admit(parts)]);
      } else {
        await admit(parts);
        await admit(parts);
      }

      expect([...members]).toEqual([USER.id]);
      expect(parts.joinedAutomatically).toHaveBeenCalledTimes(
        schedule === "repeat" ? 1 : 2,
      );
      expect(parts.joinedAutomatically).toHaveBeenCalledWith({
        organizationId: ORG.id,
        requesterUserId: USER.id,
        domain: "acme.com",
        admissionId: "rb_admission",
      });
      expect(parts.attachBindings).toHaveBeenCalledTimes(
        schedule === "repeat" ? 1 : 2,
      );
    });
  }

  /** @scenario "A failed automatic SSO notice leaves admission pending for retry" */
  it("leaves the admission pending when the durable notice handoff fails", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.joinedAutomatically.mockRejectedValue(new Error("SMTP unavailable"));

    await expect(admit(parts)).resolves.toBeUndefined();

    expect(parts.createMembership).toHaveBeenCalledOnce();
    expect(parts.attachBindings).toHaveBeenCalledOnce();
    expect(parts.joinedAutomatically).toHaveBeenCalledOnce();
    expect(parts.completeAdmission).not.toHaveBeenCalled();
    expect(await parts.findPendingAdmission()).toMatchObject({
      state: "applied",
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        connectionId: CONNECTION_ID,
      }),
      "an arrival through a single sign-on connection was not admitted (the sign-in still succeeded)",
    );
  });
});

describe("identity adoption after an authenticated SSO arrival", () => {
  /** @scenario "An admitted SSO user is adopted without a fleet-wide migration pass" */
  it("adopts only the newly admitted user after membership is created", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    await admit(parts);
    expect(parts.migrations.runTargetedPass).toHaveBeenCalledExactlyOnceWith({
      userId: USER.id,
      migrationName: "identity-d01-identifier-backfill",
    });
    expect(parts.migrations.records.get(USER.id)?.status).toBe("finalized");
    expect(parts.createMembership.mock.invocationCallOrder[0]).toBeLessThan(
      parts.migrations.runTargetedPass.mock.invocationCallOrder[0] ?? 0,
    );
  });

  /** @scenario "Existing SSO members retry adoption when new arrivals are refused" */
  it("retries adoption for an existing member when new arrivals are refused", async () => {
    const parts = serviceOver({
      row: connection({ arrivalPolicy: "refuse" }),
      member: true,
    });
    await admit(parts);
    expect(parts.migrations.records.get(USER.id)?.status).toBe("finalized");
    expect(parts.createMembership).not.toHaveBeenCalled();
    expect(parts.applyPendingInvite).not.toHaveBeenCalled();
    expect(parts.attachBindings).not.toHaveBeenCalled();
  });

  for (const policy of ["refuse", "request"] as const) {
    /** @scenario "Existing SSO members retry adoption when new arrivals are refused" */
    it(`does not adopt a fresh user while arrival policy is ${policy}`, async () => {
      const parts = serviceOver({ row: connection({ arrivalPolicy: policy }) });
      await admit(parts);
      expect(parts.migrations.runTargetedPass).not.toHaveBeenCalled();
      expect(parts.migrations.records.size).toBe(0);
    });
  }

  it("preserves admission and retries identity adoption without a duplicate notice", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.migrations.runTargetedPass.mockRejectedValueOnce(
      new Error("Migration store unavailable"),
    );
    await admit(parts);
    expect(parts.createMembership).toHaveBeenCalledOnce();
    expect(parts.migrations.records.size).toBe(0);
    parts.findMembership.mockResolvedValue(true);
    await admit(parts);
    expect(parts.migrations.records.get(USER.id)?.status).toBe("finalized");
    expect(parts.createMembership).toHaveBeenCalledOnce();
    expect(parts.joinedAutomatically).toHaveBeenCalledOnce();
  });
});

describe("unfinished SSO admission", () => {
  /** @scenario "A later SSO sign-in completes a failed admission grant" */
  it("retries the same grant after membership survives a failed append", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.attachBindings.mockRejectedValueOnce(new Error("Ledger unavailable"));

    await admit(parts);

    expect(await parts.findMembership()).toBe(true);
    expect(await parts.findPendingAdmission()).toMatchObject({
      state: "pending",
    });
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();

    await admit(parts);

    expect(parts.createMembership).toHaveBeenCalledOnce();
    expect(parts.attachBindings).toHaveBeenCalledTimes(2);
    expect(parts.attachBindings.mock.calls[1]?.[0]).toEqual(
      parts.attachBindings.mock.calls[0]?.[0],
    );
    expect(await parts.findPendingAdmission()).toBeNull();
    expect(parts.joinedAutomatically).toHaveBeenCalledOnce();
    expect(parts.migrations.records.get(USER.id)?.status).toBe("finalized");
  });

  /** @scenario "An SSO admission retry never restores revoked access" */
  it("closes a revoked intent without attaching a replacement grant", async () => {
    const parts = serviceOver({
      row: connection({ arrivalPolicy: "admit" }),
      member: true,
      pendingAdmission: {
        grantId: "rb_revoked",
        occurredAtMs: 1_756_000_000_000,
        state: "revoked",
      },
    });

    await admit(parts);

    expect(parts.attachBindings).not.toHaveBeenCalled();
    expect(parts.clearPendingAdmission).toHaveBeenCalledOnce();
    expect(parts.clearPendingAdmission).toHaveBeenCalledWith({
      userId: USER.id,
      organizationId: ORG.id,
      grantId: "rb_revoked",
    });
    expect(await parts.findPendingAdmission()).toBeNull();
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();
  });

  it("leaves an established member's intentionally absent grants alone", async () => {
    const parts = serviceOver({
      row: connection({ arrivalPolicy: "admit" }),
      member: true,
    });

    await admit(parts);

    expect(parts.attachBindings).not.toHaveBeenCalled();
    expect(parts.completeAdmission).not.toHaveBeenCalled();
  });

  it("does not announce when the membership is disabled before completion", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.completeAdmission.mockResolvedValue(false);

    await admit(parts);

    expect(parts.completeAdmission).toHaveBeenCalledOnce();
    expect(parts.joinedAutomatically).toHaveBeenCalledOnce();
  });

  /** @scenario "An accepted SSO grant remains pending until projection confirmation" */
  it("does not confirm or announce a command whose projection has not landed", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.attachBindings.mockResolvedValue({
      attached: ["rb_admission"],
      duplicates: [],
    });

    await admit(parts);

    expect(await parts.findPendingAdmission()).toMatchObject({
      state: "pending",
    });
    expect(parts.completeAdmission).not.toHaveBeenCalled();
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();
    expect(parts.migrations.runTargetedPass).not.toHaveBeenCalled();
  });
});

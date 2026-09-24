/**
 * @vitest-environment node
 * Whether the answer an administrator gave is the answer an arrival gets.
 * Each case asserts the CONSEQUENCE — a membership row, a request, a grant —
 * rather than that a branch was taken.
 * @see specs/identity/join-requests.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi, AuthzPendingAdmission } from "@langwatch/authz-contract";
import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock("@langwatch/observability", () => ({ createLogger: () => log }));

import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { SsoArrivalService } from "../sso-arrival.service.ts";

/** Only the one read an arrival makes; the other two are never reached here. */
class OneConnectionReads extends SsoConnectionReadRepository {
  constructor(readonly tryFindConnection: SsoConnectionReadRepository["tryFindConnection"]) {
    super();
  }

  tryFindDomainOwner(): never {
    throw new Error("an arrival never asks who owns a domain");
  }

  findForOrganization(): never {
    throw new Error("an arrival never lists an organization's connections");
  }
}

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const USER = { id: "user_ana", email: "ana@acme.com", name: "Ana" };
const ORG = { id: "org_acme", name: "Acme" };

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
  return {
    ...emptySsoConnection({ connectionId: CONNECTION_ID }),
    organizationId: ORG.id,
    state: "ACTIVE",
    arrivalPolicy: "request",
    arrivalPolicyDecidedAtMs: 1_756_000_000_000,
    verifiedDomains: ["acme.com"],
    domainVerifications: [DOMAIN_PROOF],
    createdBy: USER.id,
    source: "self-serve",
    ...over,
  };
}

type MembershipWrite = () => Promise<"created" | "already-present">;

function serviceOver({
  row,
  member = false,
  pendingInvite = null,
  membership = async () => "created",
  pendingAdmission = null,
}: {
  row: SsoConnectionState | null;
  member?: boolean;
  pendingInvite?: { inviteId: string } | null;
  membership?: MembershipWrite;
  pendingAdmission?: AuthzPendingAdmission | null;
}) {
  let pending = pendingAdmission;
  const isMember = vi.fn().mockResolvedValue(member);
  const createMembership = vi.fn(async () => {
    const outcome = await membership();
    if (outcome === "created") {
      isMember.mockResolvedValue(true);
      pending = { grantId: "rb_admission", occurredAtMs: 1_756_000_000_000, state: "pending" };
    }
    return outcome;
  });
  const readPendingAdmission = vi.fn(async () =>
    pending ? { pending: true as const, admission: { ...pending } } : { pending: false as const },
  );
  const completeAdmission = vi.fn(async () => {
    if (!pending) return false;
    pending = null;
    return true;
  });
  const clearPendingAdmission = vi.fn(async () => {
    pending = null;
    return true;
  });
  const attachBindings = vi.fn<AuthzApi["attachBindings"]>(async () => {
    if (pending) pending = { ...pending, state: "applied" as const };
    return { attached: ["rb_admission"], duplicates: [] };
  });

  const tryFindConnection = vi.fn().mockResolvedValue(row);
  const requestFromSsoArrival = vi.fn().mockResolvedValue({ raised: true, joinRequestId: "jr_1" });
  const applyPendingInvite = vi
    .fn()
    .mockResolvedValue(
      pendingInvite ? { applied: true, inviteId: pendingInvite.inviteId } : { applied: false },
    );
  const findOrganization = vi.fn().mockResolvedValue(ORG);
  const joinedAutomatically = vi.fn<() => Promise<void>>().mockResolvedValue();
  const announceSignup = vi.fn();
  const startNurturing = vi.fn();
  const adopt = vi.fn<() => Promise<void>>().mockResolvedValue();

  const connections = new OneConnectionReads(tryFindConnection);
  const authz = createApiFixture<AuthzApi>({
    attachBindings,
    readPendingAdmission,
    completeAdmission,
    clearPendingAdmission,
  });

  return {
    service: SsoArrivalService.create({
      connections,
      authz,
      memberships: { isMember, createMembership, applyPendingInvite, findOrganization },
      joinRequests: { requestFromSsoArrival },
      notifications: { joinedAutomatically, announceSignup, startNurturing },
      adoption: { adopt },
    }),
    isMember,
    tryFindConnection,
    requestFromSsoArrival,
    applyPendingInvite,
    attachBindings,
    joinedAutomatically,
    announceSignup,
    startNurturing,
    createMembership,
    readPendingAdmission,
    completeAdmission,
    clearPendingAdmission,
    adopt,
  };
}

const admit = (parts: ReturnType<typeof serviceOver>, domain = "acme.com"): Promise<void> =>
  parts.service.admit({ user: USER, connectionId: CONNECTION_ID, domain });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given somebody arriving through a live connection on a domain it proved", () => {
  describe("when the answer is that they ask and an administrator approves", () => {
    it("stands a request to join, and makes them no member", async () => {
      const parts = serviceOver({ row: connection() });

      await admit(parts);

      expect(parts.requestFromSsoArrival).toHaveBeenCalledWith({
        userId: USER.id,
        organizationId: ORG.id,
        domain: "acme.com",
      });
      expect(parts.createMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that they join automatically", () => {
    it("makes them a member, with the grant that membership is worth", async () => {
      const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });

      await admit(parts);

      expect(parts.createMembership).toHaveBeenCalledWith({
        userId: USER.id,
        organizationId: ORG.id,
      });
      // The grant, not just the row: a membership without one is "in the
      // organization" to older code and zero access under RBAC.
      expect(parts.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG.id,
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: USER.id },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: ORG.id,
            }),
          ],
        }),
      );
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that nobody new gets in", () => {
    it("leaves them with the account and nothing else", async () => {
      const parts = serviceOver({ row: connection({ arrivalPolicy: "refuse" }) });

      await admit(parts);

      expect(parts.createMembership).not.toHaveBeenCalled();
      expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that must admit nobody new", () => {
  it("admits nobody on a lapsed domain, though the connection is still live", async () => {
    const parts = serviceOver({
      row: connection({ domainVerifications: [{ ...DOMAIN_PROOF, proofState: "LAPSED" }] }),
    });

    await admit(parts);

    expect(parts.createMembership).not.toHaveBeenCalled();
    expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
  });

  it("does not use a legacy compatibility route as authority to admit anyone", async () => {
    const parts = serviceOver({
      row: connection({ source: "legacy-grandfathered", domainVerifications: [] }),
    });

    await admit(parts);

    expect(parts.createMembership).not.toHaveBeenCalled();
    expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
  });

  it("admits nobody while the connection is not on yet", async () => {
    const parts = serviceOver({ row: connection({ state: "VERIFIED" }) });

    await admit(parts);

    expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
  });

  it("admits nobody on a domain it never proved", async () => {
    const parts = serviceOver({ row: connection() });

    await admit(parts, "elsewhere.com");

    expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
  });
});

describe("given an account that is not a connection at all", () => {
  it("does not ask the database about it", async () => {
    const parts = serviceOver({ row: null });

    await parts.service.admit({ user: USER, connectionId: "google", domain: "acme.com" });

    expect(parts.tryFindConnection).not.toHaveBeenCalled();
  });
});

describe("given an arrival this connection was never going to admit", () => {
  const REASON_MESSAGE = "a single sign-on arrival was not considered for admission";

  describe("when the account id is not connection-shaped at all", () => {
    it("logs once at debug with reason not_a_connection_id and admits nobody", async () => {
      const parts = serviceOver({ row: null });

      await parts.service.admit({ user: USER, connectionId: "google", domain: "acme.com" });

      expect(log.info).not.toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "not_a_connection_id", connectionId: "google" }),
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
        expect.objectContaining({ reason: "connection_not_found", connectionId: CONNECTION_ID }),
        REASON_MESSAGE,
      );
      expect(parts.createMembership).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      when: "the connection is not live yet",
      reason: "domain_not_live",
      over: { state: "VERIFIED" as const },
      domain: "acme.com",
    },
    {
      when: "the address is on a domain the connection never proved",
      reason: "domain_not_proved",
      over: {},
      domain: "elsewhere.com",
    },
    {
      when: "the domain's published record has lapsed",
      reason: "domain_proof_lapsed",
      over: {
        domainVerifications: [DOMAIN_PROOF, { ...DOMAIN_PROOF, proofState: "LAPSED" as const }],
      },
      domain: "acme.com",
    },
  ])("when $when", ({ reason, over, domain }) => {
    it(`logs once with reason ${reason}`, async () => {
      const parts = serviceOver({ row: connection(over) });

      await admit(parts, domain);

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({ reason, connectionId: CONNECTION_ID, organizationId: ORG.id }),
        REASON_MESSAGE,
      );
      expect(parts.createMembership).not.toHaveBeenCalled();
    });
  });
});

describe("given a domain-matched organization to join", () => {
  it("applies a waiting invitation and writes no default membership", async () => {
    const parts = serviceOver({ row: connection(), pendingInvite: { inviteId: "inv_1" } });

    await parts.service.joinOrganization({ user: USER, org: ORG, domain: "acme.com" });

    expect(parts.applyPendingInvite).toHaveBeenCalledWith({
      userId: USER.id,
      organizationId: ORG.id,
      email: USER.email,
    });
    // The invitation's own role and team assignments carry their own grants,
    // so the default MEMBER pair must not run beside them.
    expect(parts.createMembership).not.toHaveBeenCalled();
    expect(parts.attachBindings).not.toHaveBeenCalled();
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();
    expect(parts.announceSignup).toHaveBeenCalledWith({
      userName: USER.name,
      userEmail: USER.email,
      organizationName: ORG.name,
    });
  });

  it("makes them a MEMBER, grants the organization scope and announces it", async () => {
    const parts = serviceOver({ row: connection() });

    await parts.service.joinOrganization({ user: USER, org: ORG, domain: "acme.com" });

    expect(parts.createMembership).toHaveBeenCalledWith({
      userId: USER.id,
      organizationId: ORG.id,
    });
    expect(parts.attachBindings).toHaveBeenCalledTimes(1);
    expect(parts.startNurturing).toHaveBeenCalledWith({
      userId: USER.id,
      email: USER.email,
      name: USER.name,
      organizationId: ORG.id,
      organizationName: ORG.name,
    });
  });

  it("re-asserts the grant when a concurrent callback already wrote the row", async () => {
    const parts = serviceOver({
      row: connection(),
      membership: async () => "already-present",
      pendingAdmission: {
        grantId: "rb_admission",
        occurredAtMs: 1_756_000_000_000,
        state: "pending",
      },
    });

    await parts.service.joinOrganization({ user: USER, org: ORG, domain: "acme.com" });

    expect(parts.attachBindings).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG.id, onDuplicate: "skip" }),
    );
    expect(parts.announceSignup).toHaveBeenCalledOnce();
  });
});

describe("given the queue will not take the request behind an arrival", () => {
  it("leaves the sign-in succeeding rather than raising at the person signing in", async () => {
    const parts = serviceOver({ row: connection() });
    parts.requestFromSsoArrival.mockRejectedValue(
      Object.assign(new Error("already waiting"), { code: "join_request_already_pending" }),
    );

    await expect(admit(parts)).resolves.toBeUndefined();
  });

  it("files a duplicate as an ordinary outcome and a surprise as a failure", async () => {
    const routine = serviceOver({ row: connection() });
    routine.requestFromSsoArrival.mockRejectedValue(
      Object.assign(new Error("already waiting"), { code: "join_request_already_pending" }),
    );

    await admit(routine);

    expect(log.info).toHaveBeenCalledTimes(1);

    log.info.mockClear();
    log.error.mockClear();

    const surprise = serviceOver({ row: connection() });
    surprise.requestFromSsoArrival.mockRejectedValue(new Error("the database went away"));

    await admit(surprise);

    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("swallows a membership write that fails outright, because the account is committed", async () => {
    const parts = serviceOver({
      row: connection({ arrivalPolicy: "admit" }),
      membership: () => Promise.reject(new Error("db down")),
    });

    await expect(admit(parts)).resolves.toBeUndefined();
  });
});

describe("given somebody who already belongs to the organization", () => {
  it("asks for nothing and writes nothing", async () => {
    const parts = serviceOver({ row: connection(), member: true });

    await admit(parts);

    expect(parts.requestFromSsoArrival).not.toHaveBeenCalled();
    expect(parts.createMembership).not.toHaveBeenCalled();
  });

  it("leaves an established member's intentionally absent grants alone", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }), member: true });

    await admit(parts);

    expect(parts.attachBindings).not.toHaveBeenCalled();
    expect(parts.completeAdmission).not.toHaveBeenCalled();
  });
});

describe("administrator notices after an automatic admission", () => {
  for (const schedule of ["repeat", "concurrent"] as const) {
    it(`sends one notice per new membership for ${schedule} callbacks`, async () => {
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
      expect(parts.joinedAutomatically).toHaveBeenCalledTimes(schedule === "repeat" ? 1 : 2);
      expect(parts.joinedAutomatically).toHaveBeenCalledWith({
        organizationId: ORG.id,
        requesterUserId: USER.id,
        domain: "acme.com",
        admissionId: "rb_admission",
      });
    });
  }

  it("leaves the admission pending when the durable notice handoff fails", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.joinedAutomatically.mockRejectedValue(new Error("SMTP unavailable"));

    await expect(admit(parts)).resolves.toBeUndefined();

    expect(parts.createMembership).toHaveBeenCalledOnce();
    expect(parts.attachBindings).toHaveBeenCalledOnce();
    expect(parts.completeAdmission).not.toHaveBeenCalled();
    await expect(parts.readPendingAdmission()).resolves.toMatchObject({
      admission: { state: "applied" },
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, connectionId: CONNECTION_ID }),
      "an arrival through a single sign-on connection was not admitted (the sign-in still succeeded)",
    );
  });

  it("does not announce a second time when the marker was already cleared", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.completeAdmission.mockResolvedValue(false);

    await admit(parts);

    expect(parts.completeAdmission).toHaveBeenCalledOnce();
    expect(parts.joinedAutomatically).toHaveBeenCalledOnce();
  });
});

describe("identity adoption after an authenticated arrival", () => {
  it("adopts only the newly admitted person, after the membership is created", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });

    await admit(parts);

    expect(parts.adopt).toHaveBeenCalledExactlyOnceWith({ userId: USER.id });
    expect(parts.createMembership.mock.invocationCallOrder[0]).toBeLessThan(
      parts.adopt.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("retries adoption for an existing member when new arrivals are refused", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "refuse" }), member: true });

    await admit(parts);

    expect(parts.adopt).toHaveBeenCalledExactlyOnceWith({ userId: USER.id });
    expect(parts.createMembership).not.toHaveBeenCalled();
    expect(parts.applyPendingInvite).not.toHaveBeenCalled();
  });

  for (const policy of ["refuse", "request"] as const) {
    it(`does not adopt a fresh person while the answer is ${policy}`, async () => {
      const parts = serviceOver({ row: connection({ arrivalPolicy: policy }) });

      await admit(parts);

      expect(parts.adopt).not.toHaveBeenCalled();
    });
  }
});

describe("an unfinished admission", () => {
  it("retries the same grant after a membership survived a failed append", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.attachBindings.mockRejectedValueOnce(new Error("Ledger unavailable"));

    await admit(parts);

    await expect(parts.isMember()).resolves.toBe(true);
    await expect(parts.readPendingAdmission()).resolves.toMatchObject({
      admission: { state: "pending" },
    });
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();

    await admit(parts);

    expect(parts.createMembership).toHaveBeenCalledOnce();
    expect(parts.attachBindings).toHaveBeenCalledTimes(2);
    expect(parts.attachBindings.mock.calls[1]?.[0]).toEqual(
      parts.attachBindings.mock.calls[0]?.[0],
    );
    await expect(parts.readPendingAdmission()).resolves.toEqual({ pending: false });
    expect(parts.joinedAutomatically).toHaveBeenCalledOnce();
  });

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
    expect(parts.clearPendingAdmission).toHaveBeenCalledExactlyOnceWith({
      userId: USER.id,
      organizationId: ORG.id,
      grantId: "rb_revoked",
    });
    await expect(parts.readPendingAdmission()).resolves.toEqual({ pending: false });
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();
  });

  it("neither confirms nor announces a command whose projection has not landed", async () => {
    const parts = serviceOver({ row: connection({ arrivalPolicy: "admit" }) });
    parts.attachBindings.mockResolvedValue({ attached: ["rb_admission"], duplicates: [] });

    await admit(parts);

    await expect(parts.readPendingAdmission()).resolves.toMatchObject({
      admission: { state: "pending" },
    });
    expect(parts.completeAdmission).not.toHaveBeenCalled();
    expect(parts.joinedAutomatically).not.toHaveBeenCalled();
    expect(parts.adopt).not.toHaveBeenCalled();
  });
});

describe("given a process that composed nowhere for a join request to be raised", () => {
  it("admits nobody through a connection that asks, and records that it could not", async () => {
    const tryFindConnection = vi.fn().mockResolvedValue(connection());
    const isMember = vi.fn().mockResolvedValue(false);
    const createMembership = vi.fn();
    const adopt = vi.fn<() => Promise<void>>().mockResolvedValue();
    const service = SsoArrivalService.create({
      connections: new OneConnectionReads(tryFindConnection),
      authz: createApiFixture<AuthzApi>({}),
      memberships: {
        isMember,
        createMembership,
        applyPendingInvite: vi.fn(),
        findOrganization: vi.fn(),
      },
      adoption: { adopt },
    });

    await service.admit({ user: USER, connectionId: CONNECTION_ID, domain: "acme.com" });

    expect(createMembership).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledOnce();
  });
});

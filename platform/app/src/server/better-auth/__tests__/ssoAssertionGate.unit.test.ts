import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

// The composition root builds a live Prisma client at module load. The seam
// under test takes its client as an argument, so the module only has to be
// importable.
vi.mock("~/server/app-layer/identity/runtime", async () => ({
  joinRequestsService: () => ({ requestFromSsoArrival: vi.fn() }),
  // Re-stated by the runtime because that is better-auth's one identity
  // door. It composes nothing, so the real one is what belongs here — a
  // stub would decide the very thing these scenarios are about.
  looksLikeSsoConnectionId: (
    await vi.importActual<typeof import("@langwatch/identity-server")>(
      "@langwatch/identity-server",
    )
  ).looksLikeSsoConnectionId,
}));
vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({ notifications: {}, nurturing: null }),
}));
vi.mock("@ee/sso/sso-gate", () => ({
  platformSSOAllowed: vi.fn().mockResolvedValue(true),
}));

const { ssoAssertionDecision } = await import("../hooks");

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

const connectionRow = (over: Record<string, unknown> = {}) => ({
  organizationId: "org_acme",
  state: "ACTIVE",
  verifiedDomains: ["acme.com"],
  createdBy: REGISTRAR_ID,
  ...over,
});

/**
 * A directory the membership lookup is answered FROM, rather than a canned
 * row. The gate now narrows that lookup by `userId`, and a mock that answers
 * the same way whatever it is asked cannot tell a colleague's address from
 * the registrar's — which is the whole subject of the cases below.
 */
const prismaWith = ({
  connection,
  members = [],
}: {
  connection: Record<string, unknown> | null;
  members?: { userId: string; address: string }[];
}) => {
  const findUnique = vi.fn().mockResolvedValue(connection);
  const findFirst = vi.fn(
    async ({ where }: { where: Record<string, unknown> }) => {
      const wanted = (
        where.OR as [{ user: { email: { equals: string } } }, unknown]
      )[0].user.email.equals;
      const match = members.find(
        (candidate) =>
          candidate.address === wanted &&
          (where.userId === undefined || candidate.userId === where.userId),
      );
      return match ? { userId: match.userId } : null;
    },
  );
  return {
    prisma: {
      ssoConnection: { findUnique },
      organizationUser: { findFirst },
    } as unknown as PrismaClient,
    findUnique,
    findFirst,
  };
};

const decide = (prisma: PrismaClient, email: string) =>
  ssoAssertionDecision({ prisma, providerId: CONNECTION_ID, email });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a live connection", () => {
  describe("when it asserts an address on a domain it proved", () => {
    it("lets the sign-in through", async () => {
      const { prisma } = prismaWith({ connection: connectionRow() });
      expect(await decide(prisma, "ana@acme.com")).toEqual({
        action: "continue",
      });
    });

    it("folds the asserted domain the way a claimed one is folded", async () => {
      const { prisma } = prismaWith({ connection: connectionRow() });
      // A trailing dot and a capital are the same domain. Comparing the raw
      // tail would make both of these a refusal for a legitimate employee.
      expect(await decide(prisma, "ana@ACME.com.")).toEqual({
        action: "continue",
      });
    });
  });

  describe("when it asserts an address on a domain it never proved", () => {
    /** @scenario "A provider may only assert addresses on the domains it proved" */
    it("refuses, whoever the address belongs to", async () => {
      const { prisma } = prismaWith({ connection: connectionRow() });
      const decision = await decide(prisma, "ceo@victim.test");
      expect(decision.action).toBe("reject");
    });

    it("refuses a subdomain of a domain it did prove", async () => {
      const { prisma } = prismaWith({ connection: connectionRow() });
      const decision = await decide(prisma, "ana@evil.acme.com");
      expect(decision.action).toBe("reject");
    });

    it("never asks whether the address belongs to a member", async () => {
      const { prisma, findFirst } = prismaWith({
        connection: connectionRow(),
      });
      await decide(prisma, "ceo@victim.test");
      // Membership is the setup journey's exception and belongs to connections
      // that are not live yet. A live connection asserting an unproved domain
      // must not be able to reach it by asserting a member's address.
      expect(findFirst).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that is not live yet", () => {
  const underSetup = (over: Record<string, unknown> = {}) =>
    connectionRow({ state: "DRAFT", verifiedDomains: [], ...over });

  const directory = [
    { userId: REGISTRAR_ID, address: "ana@acme.com" },
    // A colleague in the SAME organization, who also works somewhere else.
    { userId: "user_bob", address: "bob@acme.com" },
  ];

  describe("when its own administrator signs in to test it", () => {
    it("lets them through even though no domain is proved", async () => {
      // Activation refuses without a real sign-in through the connection, so
      // this path has to exist or a connection could never be activated.
      const { prisma } = prismaWith({
        connection: underSetup(),
        members: directory,
      });
      expect(await decide(prisma, "ana@acme.com")).toEqual({
        action: "continue",
      });
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
      const { prisma } = prismaWith({
        connection: underSetup(),
        members: directory,
      });
      const decision = await decide(prisma, "bob@acme.com");
      expect(decision.action).toBe("reject");
    });

    it("narrows the membership lookup by the registrar, not just the organization", async () => {
      const { prisma, findFirst } = prismaWith({
        connection: underSetup(),
        members: directory,
      });
      await decide(prisma, "bob@acme.com");
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org_acme",
            userId: REGISTRAR_ID,
          }),
        }),
      );
    });
  });

  describe("when nobody is recorded as having registered it", () => {
    it("refuses, because there is no administrator to make an exception for", async () => {
      const { prisma, findFirst } = prismaWith({
        connection: underSetup({ createdBy: null }),
        members: directory,
      });
      const decision = await decide(prisma, "ana@acme.com");
      expect(decision.action).toBe("reject");
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe("when it asserts an address belonging to nobody in its organization", () => {
    it("refuses", async () => {
      const { prisma } = prismaWith({
        connection: underSetup(),
        members: directory,
      });
      const decision = await decide(prisma, "ceo@victim.test");
      expect(decision.action).toBe("reject");
    });

    it("refuses even when that address is on a domain it has claimed", async () => {
      // Claiming is not proving. A claim is a sentence the customer typed.
      const { prisma } = prismaWith({
        connection: underSetup({ state: "CLAIMED" }),
        members: directory,
      });
      const decision = await decide(prisma, "ceo@victim.test");
      expect(decision.action).toBe("reject");
    });
  });
});

describe("given an assertion that names no connection we hold", () => {
  describe("when it reaches the gate", () => {
    it("refuses an id that is shaped like a connection but is not one", async () => {
      const { prisma } = prismaWith({ connection: null });
      const decision = await decide(prisma, "ana@acme.com");
      expect(decision.action).toBe("reject");
    });

    it("refuses an id that is not a connection id at all", async () => {
      const { prisma, findUnique } = prismaWith({
        connection: connectionRow(),
      });
      const decision = await ssoAssertionDecision({
        prisma,
        providerId: "google",
        email: "ana@acme.com",
      });
      expect(decision.action).toBe("reject");
      // Cheap first, and it matters: the deployment's own brokered provider
      // does not come through this plugin, so an id that is not a connection's
      // is anomalous rather than routine.
      expect(findUnique).not.toHaveBeenCalled();
    });
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
      const { prisma } = prismaWith({ connection: connectionRow() });
      const decision = await ssoAssertionDecision({
        prisma,
        providerId: CONNECTION_ID,
        email,
      });
      expect(decision.action).toBe("reject");
    });
  });
});

describe("given several different reasons to refuse", () => {
  describe("when each is refused", () => {
    /** @scenario "Every refusal at the door says the same thing" */
    it("answers one code, so the refusal names no cause", async () => {
      const causes = await Promise.all([
        decide(prismaWith({ connection: null }).prisma, "ana@acme.com"),
        decide(prismaWith({ connection: connectionRow() }).prisma, "x@no.test"),
        // No `members`, which is the default: this case is refused for the
        // connection's state, and a member list would not change the answer.
        decide(
          prismaWith({ connection: connectionRow({ state: "DRAFT" }) }).prisma,
          "x@acme.com",
        ),
      ]);

      const codes = new Set(
        causes.map((decision) =>
          decision.action === "reject" ? decision.code : "continued",
        ),
      );
      // An unauthenticated caller learns that they were refused and nothing
      // about which of the checks refused them.
      expect(codes).toEqual(new Set(["identity_sign_in_refused"]));
    });
  });
});

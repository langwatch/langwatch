import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

const requestFromSsoArrival = vi
  .fn()
  .mockResolvedValue({ joinRequestId: "jr_1" });

// The composition root builds a live Prisma client at module load, which a
// unit test has no business starting. The seam under test is what it CALLS.
vi.mock("~/server/app-layer/identity/runtime", async () => ({
  joinRequestsService: () => ({ requestFromSsoArrival }),
  // Re-stated by the runtime because that is better-auth's one identity
  // door. It composes nothing, so the real one is what belongs here — a
  // stub would decide the very thing these scenarios are about.
  looksLikeSsoConnectionId: (
    await vi.importActual<typeof import("@langwatch/identity-server")>(
      "@langwatch/identity-server",
    )
  ).looksLikeSsoConnectionId,
}));

// The membership write announces itself, and the announcement reaches for the
// App. Stubbed for the same reason the ledger writer is: without it the throw
// is swallowed by the catch and every assertion downstream of it is green on
// the way past a failure.
vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    notifications: {
      sendSlackSignupEvent: vi.fn().mockResolvedValue(undefined),
    },
    nurturing: null,
  }),
}));

vi.mock("@ee/sso/sso-gate", () => ({
  platformSSOAllowed: vi.fn().mockResolvedValue(true),
}));

const { admitSsoArrival } = await import("../hooks");

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

const connectionRow = (over: Record<string, unknown> = {}) => ({
  organizationId: "org_acme",
  state: "ACTIVE",
  arrivalPolicy: "request",
  verifiedDomains: ["acme.com"],
  lapsedDomains: [],
  ...over,
});

const prismaWith = ({
  connection,
  member = null,
}: {
  connection: Record<string, unknown> | null;
  member?: { userId: string } | null;
}) => {
  const create = vi.fn().mockResolvedValue(undefined);
  const findUnique = vi.fn().mockResolvedValue(connection);
  return {
    prisma: {
      ssoConnection: { findUnique },
      organizationUser: {
        findFirst: vi.fn().mockResolvedValue(member),
        create,
      },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "org_acme", name: "Acme" }),
      },
      organizationInvite: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $connect: vi.fn(),
    } as unknown as PrismaClient,
    create,
    findUnique,
  };
};

// The grant beside the membership row (ADR-092). Stubbed rather than
// omitted: without it `joinSsoOrganization` throws, the swallow-and-log
// catch hides it, and the membership assertion passes on the way past a
// failure — a test that is green for the wrong reason.
const attachBindings = vi.fn().mockResolvedValue(undefined);
const writer = { attachBindings } as never;

const admit = (prisma: PrismaClient, domain = "acme.com") =>
  admitSsoArrival({
    prisma,
    writer,
    user: USER,
    connectionId: CONNECTION_ID,
    domain,
  });

beforeEach(() => {
  requestFromSsoArrival.mockClear();
  attachBindings.mockClear();
});

describe("given somebody arriving through a live connection on a domain it proved", () => {
  describe("when the answer is that they ask and an administrator approves", () => {
    /** @scenario "An arrival on a connection that asks keeps the account and waits" */
    it("stands a request to join, and makes them no member", async () => {
      const { prisma, create } = prismaWith({ connection: connectionRow() });

      await admit(prisma);

      expect(requestFromSsoArrival).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        domain: "acme.com",
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that they join automatically", () => {
    it("makes them a member and asks nobody", async () => {
      const { prisma, create } = prismaWith({
        connection: connectionRow({ arrivalPolicy: "admit" }),
      });

      await admit(prisma);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user_ana",
            organizationId: "org_acme",
          }),
        }),
      );
      // The grant, not just the row: a membership without one is "in the
      // org" to legacy code and zero access under RBAC.
      expect(attachBindings).toHaveBeenCalled();
      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the answer is that nobody new gets in", () => {
    it("leaves them with the account and nothing else", async () => {
      const { prisma, create } = prismaWith({
        connection: connectionRow({ arrivalPolicy: "refuse" }),
      });

      await admit(prisma);

      expect(create).not.toHaveBeenCalled();
      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given a connection that must admit nobody new", () => {
  describe("when the domain's published record has lapsed", () => {
    /** ADR-123: a lapsed domain still routes, and stops provisioning. */
    it("admits nobody, though the connection is still live", async () => {
      const { prisma, create } = prismaWith({
        connection: connectionRow({ lapsedDomains: ["acme.com"] }),
      });

      await admit(prisma);

      expect(create).not.toHaveBeenCalled();
      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the connection is not on yet", () => {
    it("admits nobody", async () => {
      const { prisma } = prismaWith({
        connection: connectionRow({ state: "VERIFIED" }),
      });

      await admit(prisma);

      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when the address is on a domain it never proved", () => {
    it("admits nobody", async () => {
      const { prisma } = prismaWith({ connection: connectionRow() });

      await admit(prisma, "elsewhere.com");

      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });

  describe("when they are already a member", () => {
    it("asks nothing, which is every administrator testing their own connection", async () => {
      const { prisma, create } = prismaWith({
        connection: connectionRow(),
        member: { userId: "user_ana" },
      });

      await admit(prisma);

      expect(create).not.toHaveBeenCalled();
      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });
  });
});

describe("given an account that is not a connection at all", () => {
  it("does not ask the database about it", async () => {
    const { prisma, findUnique } = prismaWith({ connection: null });

    await admitSsoArrival({
      prisma,
      writer,
      user: USER,
      connectionId: "google",
      domain: "acme.com",
    });

    expect(findUnique).not.toHaveBeenCalled();
  });
});

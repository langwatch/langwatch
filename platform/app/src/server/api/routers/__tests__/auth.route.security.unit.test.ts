import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { RoutingDecision } from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { authRouter } from "../auth";

const { rateLimitMock, routeMock } = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  routeMock: vi.fn(),
}));

vi.mock("~/server/rateLimit", () => ({ rateLimit: rateLimitMock }));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  signInRouter: () => ({ route: routeMock }),
}));

// A handled refusal passes through the mutation audit middleware. Keep this a
// unit test of the public budgets rather than opening a Prisma connection.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const REDIRECT_DECISION: RoutingDecision = {
  outcome: "redirect_to_connection",
  connectionId: "ssoc_acme",
  methodSet: [{ id: "okta", kind: "federated", connectionId: "ssoc_acme" }],
  reasonCode: "domain_routed",
};

function caller({
  peer,
  forwarded = "198.51.100.77",
}: {
  peer?: string;
  forwarded?: string;
}) {
  const req = Object.assign(new IncomingMessage(new Socket()), {
    query: {},
    cookies: {},
    env: {},
  });
  req.headers = { "x-forwarded-for": forwarded };
  if (peer !== undefined) {
    Object.defineProperty(req.socket, "remoteAddress", {
      configurable: true,
      value: peer,
    });
  }

  return authRouter.createCaller(
    createInnerTRPCContext({
      req,
      res: undefined,
      session: null,
      permissionChecked: false,
      publiclyShared: false,
    }),
  );
}

describe("auth.route public budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60 * 60_000,
    });
    routeMock.mockResolvedValue(REDIRECT_DECISION);
  });

  /** @scenario Public auth limits ignore caller-controlled forwarding headers */
  it("keys the caller budget on the direct socket peer", async () => {
    await caller({ peer: "203.0.113.9" }).route({
      identifier: "sam@example.com",
    });

    expect(rateLimitMock).toHaveBeenNthCalledWith(1, {
      key: "auth.route:203.0.113.9",
      windowSeconds: 60 * 60,
      max: 60,
    });
    expect(rateLimitMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "auth.route:198.51.100.77" }),
    );
  });

  /** @scenario Auth routing spends one canonical per-address budget */
  it("hashes canonical addresses while preserving distinct plus tags", async () => {
    const routeCaller = caller({ peer: "203.0.113.9" });

    await routeCaller.route({ identifier: " Sam+First@Example.COM " });
    await routeCaller.route({ identifier: "sam+first@example.com" });
    await routeCaller.route({ identifier: "sam+second@example.com" });

    const addressKeys = rateLimitMock.mock.calls
      .map(([options]) => options.key)
      .filter((key: string) => key.startsWith("auth.route:address:"));
    expect(addressKeys[0]).toBe(addressKeys[1]);
    expect(addressKeys[2]).not.toBe(addressKeys[0]);
    expect(addressKeys).toHaveLength(3);
    for (const key of addressKeys) {
      expect(key).toMatch(/^auth\.route:address:[a-f0-9]{64}$/);
    }
    expect(addressKeys.join(" ")).not.toContain("sam");
  });

  /** @scenario A route request without an identifier has no address budget */
  it("uses the conservative unknown-peer bucket and skips an absent address", async () => {
    await caller({}).route({ identifier: null });

    expect(rateLimitMock).toHaveBeenCalledOnce();
    expect(rateLimitMock).toHaveBeenCalledWith({
      key: "auth.route:unknown",
      windowSeconds: 60 * 60,
      max: 60,
    });
  });

  /** @scenario Auth routing is refused when either public budget is exhausted */
  it("enforces both the peer and address budgets", async () => {
    rateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    await expect(
      caller({ peer: "203.0.113.9" }).route({
        identifier: "sam@example.com",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(routeMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    rateLimitMock
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 59,
        resetAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      });

    await expect(
      caller({ peer: "203.0.113.9" }).route({
        identifier: "sam@example.com",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(routeMock).not.toHaveBeenCalled();
  });

  /** @scenario The auth.route wire response has one provider identifier */
  it("omits the redundant top-level connection id from serialization", async () => {
    const response = await caller({ peer: "203.0.113.9" }).route({
      identifier: "sam@example.com",
    });
    const serialized = JSON.parse(JSON.stringify(response)) as Record<
      string,
      unknown
    >;

    expect(serialized).not.toHaveProperty("connectionId");
    expect(serialized).toEqual({
      outcome: "redirect_to_connection",
      methodSet: [{ id: "okta", kind: "federated", connectionId: "ssoc_acme" }],
      reasonCode: "domain_routed",
    });
  });
});

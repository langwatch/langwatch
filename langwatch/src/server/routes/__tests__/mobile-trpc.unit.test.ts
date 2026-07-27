/**
 * HTTP-level tests for the mobile tRPC mount. Requests go through the real Hono
 * app and the real tRPC adapter, so the token auth, the router scoping and the
 * wire envelope are exercised as a client would meet them; only the boundaries
 * — Redis, Prisma, the ops app layer and the admin allow-list — are mocked.
 *
 * Spec: specs/ops/mobile-ops-api.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisGet = vi.fn();
const redisDel = vi.fn();

vi.mock("~/server/redis", () => ({
  connection: {
    get: (...args: unknown[]) => redisGet(...args),
    del: (...args: unknown[]) => redisDel(...args),
  },
}));

const findUniqueUser = vi.fn();
const createAuditLog = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    // `auditLogTRPCErrors` writes a row for every non-500 procedure error, so a
    // FORBIDDEN on this mount lands in the audit trail like any other. Without
    // this stub the write throws and masks the FORBIDDEN as a 500.
    auditLog: { create: (...args: unknown[]) => createAuditLog(...args) },
  },
}));

const isAdminEmail = vi.fn();

vi.mock("../../../../ee/admin/isAdmin", () => ({
  isAdmin: ({ email }: { email?: string | null }) => isAdminEmail(email),
}));

const getQueues = vi.fn();
const getDashboardData = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    ops: {
      queues: { getQueues },
      metricsCollector: { getDashboardData },
    },
  }),
}));

const { app } = await import("../mobile-trpc");
const { mobileRouter } = await import("~/server/api/mobile-root");

const VALID_TOKEN = "lw_at_test-token";
const OPERATOR_EMAIL = "operator@langwatch.ai";

function givenSignedIn({
  email = OPERATOR_EMAIL,
  isOps = true,
}: { email?: string; isOps?: boolean } = {}) {
  redisGet.mockResolvedValue(
    JSON.stringify({
      user_id: "user-1",
      organization_id: "org-1",
      issued_at: Date.now() - 1000,
      expires_at: Date.now() + 60_000,
    }),
  );
  findUniqueUser.mockResolvedValue({
    id: "user-1",
    name: "Operator",
    email,
    image: null,
  });
  isAdminEmail.mockImplementation((e: string | null) => isOps && e === email);
}

/** Call a query the way the tRPC HTTP client does: GET with a superjson input. */
function query(
  procedure: string,
  { token, input }: { token?: string; input?: unknown } = {},
) {
  const url = new URL(`http://localhost/api/mobile/trpc/${procedure}`);
  if (input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ json: input }));
  }
  return app.request(url.toString(), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

/** tRPC answers 200 with an error envelope for some codes, so read the body. */
async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as {
    error?: { json?: { data?: { code?: string } } };
  };
  return body.error?.json?.data?.code;
}

describe("mobile tRPC mount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQueues.mockResolvedValue([]);
    getDashboardData.mockReturnValue({ throughputHistory: [], queues: [] });
  });

  describe("given no credentials", () => {
    describe("when a procedure is called", () => {
      it("refuses as unauthorized", async () => {
        const response = await query("ops.listQueues");

        expect(await errorCodeOf(response)).toBe("UNAUTHORIZED");
      });

      it("does not reach the ops services", async () => {
        await query("ops.listQueues");

        expect(getQueues).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a session cookie instead of a bearer token", () => {
    describe("when a procedure is called", () => {
      it("refuses — this mount never reads cookies", async () => {
        const response = await app.request(
          "http://localhost/api/mobile/trpc/ops.listQueues",
          { headers: { cookie: "better-auth.session_token=whatever" } },
        );

        expect(await errorCodeOf(response)).toBe("UNAUTHORIZED");
      });
    });
  });

  describe("given an expired access token", () => {
    describe("when a procedure is called", () => {
      it("refuses and discards the stored token", async () => {
        redisGet.mockResolvedValue(
          JSON.stringify({
            user_id: "user-1",
            organization_id: "org-1",
            issued_at: Date.now() - 10_000,
            expires_at: Date.now() - 1_000,
          }),
        );

        const response = await query("ops.listQueues", { token: VALID_TOKEN });

        expect(await errorCodeOf(response)).toBe("UNAUTHORIZED");
        expect(redisDel).toHaveBeenCalledWith(`lwcli:access:${VALID_TOKEN}`);
      });
    });
  });

  describe("given a token for a user that no longer exists", () => {
    describe("when a procedure is called", () => {
      it("refuses rather than acting on a ghost", async () => {
        redisGet.mockResolvedValue(
          JSON.stringify({
            user_id: "deleted-user",
            organization_id: "org-1",
            issued_at: Date.now() - 1000,
            expires_at: Date.now() + 60_000,
          }),
        );
        findUniqueUser.mockResolvedValue(null);

        const response = await query("ops.listQueues", { token: VALID_TOKEN });

        expect(await errorCodeOf(response)).toBe("UNAUTHORIZED");
      });
    });
  });

  describe("given a signed-in user without ops access", () => {
    describe("when a procedure is called", () => {
      it("refuses with the same permission error the web surface gives", async () => {
        givenSignedIn({ email: "someone@example.com", isOps: false });

        const response = await query("ops.listQueues", { token: VALID_TOKEN });

        expect(await errorCodeOf(response)).toBe("FORBIDDEN");
      });

      it("records the refusal in the audit trail", async () => {
        givenSignedIn({ email: "someone@example.com", isOps: false });

        await query("ops.listQueues", { token: VALID_TOKEN });

        expect(createAuditLog).toHaveBeenCalled();
      });
    });

    describe("when the scope probe is called", () => {
      it("succeeds and reports no access, so the app can explain rather than error", async () => {
        givenSignedIn({ email: "someone@example.com", isOps: false });

        const response = await query("ops.getScope", { token: VALID_TOKEN });
        const body = (await response.json()) as {
          result?: { data?: { json?: { scope?: { kind?: string } } } };
        };

        expect(body.result?.data?.json?.scope?.kind).toBe("none");
      });
    });
  });

  describe("given a signed-in operator", () => {
    beforeEach(() => givenSignedIn());

    describe("when a query is called", () => {
      it("returns the same data the web surface would", async () => {
        getQueues.mockResolvedValue([
          { name: "langwatch:traces:gq", displayName: "traces" },
        ]);

        const response = await query("ops.listQueues", { token: VALID_TOKEN });
        const body = (await response.json()) as {
          result?: { data?: { json?: unknown } };
        };

        expect(response.status).toBe(200);
        expect(body.result?.data?.json).toEqual([
          { name: "langwatch:traces:gq", displayName: "traces" },
        ]);
      });

      it("encodes the response with superjson, as the client expects", async () => {
        const response = await query("ops.listQueues", { token: VALID_TOKEN });
        const body = (await response.json()) as Record<string, unknown>;

        // The `json` wrapper key is superjson's envelope. A client configured
        // with the transformer reads through it; without it the client would
        // silently hand screens the raw envelope.
        expect(body).toHaveProperty("result.data.json");
      });
    });

    describe("when a query with input is called", () => {
      it("passes the input through", async () => {
        getQueues.mockResolvedValue([]);

        const response = await query("ops.listPausedKeys", {
          token: VALID_TOKEN,
          input: { queueName: "langwatch:traces:gq" },
        });

        // The procedure ran — it got past auth and past Zod — rather than being
        // rejected at the door. What the ops layer then does with it is that
        // layer's own test.
        const code = await errorCodeOf(response);
        expect(code).not.toBe("UNAUTHORIZED");
        expect(code).not.toBe("BAD_REQUEST");
      });
    });
  });

  describe("the surface this mount exposes", () => {
    it("carries the ops namespace and nothing else", () => {
      // A device-flow token is a keyring credential that predates this app. If
      // this assertion ever fails, someone has widened what a lost phone can
      // reach — which is a decision to make deliberately, not to inherit.
      const namespaces = new Set(
        Object.keys(mobileRouter._def.procedures).map((path) =>
          path.split(".")[0],
        ),
      );

      expect([...namespaces]).toEqual(["ops"]);
    });

    it("exposes the very same procedures as the web ops router", async () => {
      const { opsRouter } = await import("~/server/api/routers/ops");

      const mobile = Object.keys(mobileRouter._def.procedures)
        .filter((path) => path.startsWith("ops."))
        .map((path) => path.slice("ops.".length))
        .sort();
      const web = Object.keys(opsRouter._def.procedures).sort();

      expect(mobile).toEqual(web);
    });
  });
});

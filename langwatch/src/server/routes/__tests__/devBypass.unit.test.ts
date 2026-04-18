import { beforeEach, describe, expect, it, vi } from "vitest";

type MockUser = { id: string; email: string | null; name: string | null };

type UpsertArgs = {
  where: { email: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

type CreatedSession = { id: string; token: string; userId: string };

const state = {
  users: new Map<string, MockUser>(),
  sessions: [] as CreatedSession[],
  env: { NODE_ENV: "test" as string, LOCAL_DEV_BYPASS_AUTH: undefined as string | undefined },
};

vi.mock("~/env.mjs", () => ({
  get env() {
    return state.env;
  },
}));

vi.mock("~/server/db", () => ({
  prisma: {
    user: {
      upsert: vi.fn(async (args: UpsertArgs): Promise<MockUser> => {
        const existing = state.users.get(args.where.email);
        if (existing) return existing;
        const user: MockUser = {
          id: `user_${state.users.size + 1}`,
          email: args.where.email,
          name: (args.create.name as string) ?? null,
        };
        state.users.set(user.email!, user);
        return user;
      }),
    },
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("~/server/better-auth", () => ({
  auth: {
    api: { getSession: vi.fn() },
    handler: vi.fn(),
    $context: Promise.resolve({
      secret: "unit-test-secret-32-bytes-exact!!",
      internalAdapter: {
        createSession: vi.fn(async (userId: string): Promise<CreatedSession> => {
          const session = {
            id: `sess_${state.sessions.length + 1}`,
            token: `token_${state.sessions.length + 1}`,
            userId,
          };
          state.sessions.push(session);
          return session;
        }),
      },
      authCookies: {
        sessionToken: {
          name: "better-auth.session_token",
          attributes: {
            path: "/",
            maxAge: 60 * 60 * 24,
            httpOnly: true,
            sameSite: "lax" as const,
            secure: false,
          },
        },
      },
    }),
  },
}));

vi.mock("~/server/redis", () => ({ connection: null }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

vi.mock("~/server/auth", () => ({ getServerAuthSession: vi.fn() }));
vi.mock("~/server/better-auth/originGate", () => ({
  isAllowedAuthOrigin: () => true,
}));

describe("GET /api/auth/dev-bypass", () => {
  let app: typeof import("../auth").app;

  beforeEach(async () => {
    state.users.clear();
    state.sessions.length = 0;
    vi.resetModules();
    const module = await import("../auth");
    app = module.app;
  });

  describe("when NODE_ENV is not development", () => {
    it("returns 404 even with the flag set", async () => {
      state.env = { NODE_ENV: "production", LOCAL_DEV_BYPASS_AUTH: "true" };

      const res = await app.fetch(
        new Request("http://localhost/api/auth/dev-bypass"),
      );

      expect(res.status).toBe(404);
      expect(state.sessions).toHaveLength(0);
    });
  });

  describe("when LOCAL_DEV_BYPASS_AUTH flag is unset", () => {
    it("returns 404 even in development mode", async () => {
      state.env = { NODE_ENV: "development", LOCAL_DEV_BYPASS_AUTH: "false" };

      const res = await app.fetch(
        new Request("http://localhost/api/auth/dev-bypass"),
      );

      expect(res.status).toBe(404);
      expect(state.sessions).toHaveLength(0);
    });
  });

  describe("when both gates are satisfied", () => {
    beforeEach(() => {
      state.env = { NODE_ENV: "development", LOCAL_DEV_BYPASS_AUTH: "true" };
    });

    it("upserts the dev user and creates a Session via BetterAuth internal adapter", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/dev-bypass", {
          redirect: "manual",
        }),
      );

      expect(res.status).toBe(302);
      expect(state.users.size).toBe(1);
      expect(state.users.get("dev@localhost.langwatch.ai")?.name).toBe(
        "Local Dev User",
      );
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.token).toBe("token_1");
    });

    it("sets the better-auth session cookie with HMAC signature", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/dev-bypass", {
          redirect: "manual",
        }),
      );

      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("better-auth.session_token=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      // Cookie shape is <token>.<signature> after URL decoding
      const match = /better-auth\.session_token=([^;]+)/.exec(setCookie);
      expect(match).not.toBeNull();
      const decoded = decodeURIComponent(match![1]!);
      expect(decoded.startsWith("token_1.")).toBe(true);
      expect(decoded.length).toBeGreaterThan("token_1.".length);
    });

    it("redirects to the `redirect` query param when provided", async () => {
      const res = await app.fetch(
        new Request(
          "http://localhost/api/auth/dev-bypass?redirect=%2Fgateway%2Fvirtual-keys",
          { redirect: "manual" },
        ),
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/gateway/virtual-keys");
    });

    it("reuses the dev user on repeat invocations", async () => {
      await app.fetch(
        new Request("http://localhost/api/auth/dev-bypass", {
          redirect: "manual",
        }),
      );
      await app.fetch(
        new Request("http://localhost/api/auth/dev-bypass", {
          redirect: "manual",
        }),
      );

      expect(state.users.size).toBe(1);
      expect(state.sessions).toHaveLength(2);
      const [a, b] = state.sessions;
      expect(a?.token).not.toBe(b?.token);
    });
  });
});

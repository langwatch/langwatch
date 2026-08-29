import {
  AuthService,
  type BrowserSession,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import type {
  AuthzPermission,
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApiAuthSessionCompositionPort,
  AuthSessionApiAuthenticationAdapter,
  BetterAuthBrowserSessionTransportAdapter,
  type ApiAuthSessionDependencies,
} from "../api-auth.composition";
import { ApiAuthorizationPort, ApiRequestPolicy } from "../../api-request.policy";

const verified: VerifiedBrowserSession = {
  session: { id: "session-1", expiresAt: new Date("2026-08-28T12:00:00.000Z") },
  user: { id: "user-1", name: "Alex", email: "alex@example.test", image: null },
};

const browserSession: BrowserSession = {
  user: { id: "user-1", name: "Alex", email: "alex@example.test", image: null },
  expires: "2026-08-28T12:00:00.000Z",
  sessionId: "session-1",
};

class TestAuthService extends AuthService {
  readonly tryResolveBrowserSession = vi.fn(
    async (_input: { verified: VerifiedBrowserSession | null }): Promise<BrowserSession | null> =>
      browserSession,
  );
  readonly revokeAllBrowserSessions = vi.fn(async (_input: { userId: string }) => undefined);
  readonly revokeBrowserSession = vi.fn(async (_input: { sessionId: string }) => undefined);
  readonly revokeOtherBrowserSessions = vi.fn(
    async (_input: { userId: string; keepSessionId: string }) => undefined,
  );
}

class TestAuthorization extends ApiAuthorizationPort {
  async can(_input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<boolean> {
    return true;
  }

  async authorizeProject(_input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<void> {}

  async checkScopeLineage(_input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> {
    return { kind: "consistent" };
  }
}

class TestAuthComposition extends ApiAuthSessionCompositionPort {
  readonly compose = vi.fn(() => this.dependencies);

  constructor(private readonly dependencies: ApiAuthSessionDependencies) {
    super();
  }
}

describe("API Auth/session composition", () => {
  it("uses one injected Auth service after Better Auth verifies the request", async () => {
    const getSession = vi.fn(async (_input: { headers: Headers }) => verified);
    const auth = new TestAuthService();
    const sessions = BetterAuthBrowserSessionTransportAdapter.create({
      api: { getSession },
    });
    const composition = new TestAuthComposition({ auth, sessions });
    const authentication = AuthSessionApiAuthenticationAdapter.create(composition.compose());
    const request = new Request("https://api.example.test/api/trpc", {
      headers: { cookie: "better-auth.session_token=token-1" },
    });
    const policy = ApiRequestPolicy.create({
      authentication,
      authorization: new TestAuthorization(),
    });

    const context = await policy.createContext(request);

    expect(context.actor()).toEqual({ id: "user-1" });
    expect(composition.compose).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledWith({ headers: request.headers });
    expect(auth.tryResolveBrowserSession).toHaveBeenCalledWith({ verified });
  });

  it("fails closed when Better Auth cannot verify the browser session", async () => {
    const getSession = vi.fn(async (_input: { headers: Headers }) => {
      throw new Error("secondary session store unavailable");
    });
    const auth = new TestAuthService();
    const authentication = AuthSessionApiAuthenticationAdapter.create({
      auth,
      sessions: BetterAuthBrowserSessionTransportAdapter.create({ api: { getSession } }),
    });

    await expect(
      authentication.authenticate(new Request("https://api.example.test/api/trpc")),
    ).resolves.toBe(null);
    expect(auth.tryResolveBrowserSession).not.toHaveBeenCalled();
  });

  it("turns a revoked Auth session into the existing unauthorized policy path", async () => {
    const auth = new TestAuthService();
    auth.tryResolveBrowserSession.mockResolvedValueOnce(null);
    const authentication = AuthSessionApiAuthenticationAdapter.create({
      auth,
      sessions: BetterAuthBrowserSessionTransportAdapter.create({
        api: { getSession: async (_input) => verified },
      }),
    });
    const policy = ApiRequestPolicy.create({
      authentication,
      authorization: new TestAuthorization(),
    });

    const context = await policy.createContext(new Request("https://api.example.test/api/trpc"));

    expect(() => context.actor()).toThrow(TRPCError);
    expect(() => context.actor()).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("fails closed when the Auth service cannot resolve a verified session", async () => {
    const auth = new TestAuthService();
    auth.tryResolveBrowserSession.mockRejectedValueOnce(new Error("database unavailable"));
    const authentication = AuthSessionApiAuthenticationAdapter.create({
      auth,
      sessions: BetterAuthBrowserSessionTransportAdapter.create({
        api: { getSession: async (_input) => verified },
      }),
    });

    await expect(
      authentication.authenticate(new Request("https://api.example.test/api/trpc")),
    ).resolves.toBe(null);
  });
});

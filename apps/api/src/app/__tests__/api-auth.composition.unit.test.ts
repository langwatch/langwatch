/**
 * Spec: specs/server/api-process-auth.feature
 */
import {
  AuthService,
  type BrowserSession,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { UserService } from "@langwatch/user-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { PrismaConnection } from "@langwatch/prisma-client";
import type {
  AuthzPermission,
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApiAuthAbsenceReportPort,
  ApiAuthComposition,
  ApiAuthSessionCompositionPort,
  ApiBrowserSessionTransportPort,
  AuthSessionApiAuthenticationAdapter,
  BetterAuthBrowserSessionTransportAdapter,
  type ApiAuthSessionDependencies,
} from "../api-auth.composition";
import { UnavailableApiUserAvatarStorageAdapter } from "../api-user-avatar-storage.adapter";
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

/**
 * The user directory the Auth graph publishes, as a double.
 *
 * Every call refuses: this file describes how a verified browser session
 * becomes an actor, and that path reads no user through this seam — the
 * identity half does.
 */
function testUserService(): UserService {
  return new Proxy({} as UserService, {
    get(_target, property) {
      return () => {
        throw new Error(`the auth composition test reached users.${String(property)}`);
      };
    },
  });
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
    const composition = new TestAuthComposition({ auth, sessions, users: testUserService() });
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

  /** @scenario "A transport that throws still leaves the caller anonymous" */
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

  /** @scenario "A verified session the Auth service cannot resolve is logged" */
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

  /** @scenario "An Auth service that throws still leaves the caller anonymous" */
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

describe("when a request presents a Better Auth session token", () => {
  /** @scenario "A session token Better Auth rejects is logged as a refusal" */
  it("records the refusal with the cookie name it arrived under", async () => {
    // The factory hands back one logger per name for the life of the process,
    // so this is the instance the composition module already holds.
    const warn = vi.spyOn(createLogger("langwatch:api:auth"), "warn");
    const sessions = BetterAuthBrowserSessionTransportAdapter.create({
      api: { getSession: async () => null },
    });

    const resolved = await sessions.tryResolveVerifiedSession(
      new Request("https://api.example.test/api/trpc", {
        headers: { cookie: "__Secure-better-auth.session_token=a-token; other=1" },
      }),
    );
    // Restored before the assertions: a spy left installed by a failing
    // expectation would leak its call history into the next test.
    const calls = [...warn.mock.calls];
    warn.mockRestore();

    expect(resolved).toBe(null);
    expect(calls).toEqual([
      [
        { cookies: ["__Secure-better-auth.session_token"] },
        expect.stringContaining("rejected a browser session token"),
      ],
    ]);
    // The name identifies the cookie configuration; the value is a credential.
    expect(JSON.stringify(calls)).not.toContain("a-token");
  });

  /** @scenario "An anonymous request is not logged as a refusal" */
  it("records nothing for a request carrying no session cookie", async () => {
    const warn = vi.spyOn(createLogger("langwatch:api:auth"), "warn");
    const sessions = BetterAuthBrowserSessionTransportAdapter.create({
      api: { getSession: async () => null },
    });

    await sessions.tryResolveVerifiedSession(
      new Request("https://api.example.test/api/trpc", {
        headers: { cookie: "better-auth.session_data=cached; theme=dark" },
      }),
    );
    const calls = [...warn.mock.calls];
    warn.mockRestore();

    expect(calls).toEqual([]);
  });

  /** @scenario "A verified session the Auth service cannot resolve is logged" */
  it("records a verified session the Auth service could not resolve", async () => {
    const warn = vi.spyOn(createLogger("langwatch:api:auth"), "warn");
    const auth = new TestAuthService();
    auth.tryResolveBrowserSession.mockResolvedValueOnce(null);
    const authentication = AuthSessionApiAuthenticationAdapter.create({
      auth,
      sessions: BetterAuthBrowserSessionTransportAdapter.create({
        api: { getSession: async () => verified },
      }),
    });

    await authentication.authenticate(new Request("https://api.example.test/api/trpc"));
    const calls = [...warn.mock.calls];
    warn.mockRestore();

    expect(calls).toEqual([
      [{ sessionId: "session-1", userId: "user-1" }, expect.stringContaining("could not resolve")],
    ]);
  });
});

type Row = Record<string, unknown>;

const IDENTIFIER_ADDRESS = "alex@identifiers.test";
const STORED_ADDRESS = "alex@stored.test";

/**
 * A client that answers the four reads a composed browser-session resolution
 * makes and refuses everything else, so a query this graph should not make
 * cannot pass unnoticed.
 */
function stubConnection(options: { finalized: boolean }): PrismaConnection {
  const refuse = () => {
    throw new Error("This scenario describes only the browser-session reads.");
  };
  const client = {
    session: {
      findUnique: () =>
        Promise.resolve({
          id: "session-1",
          userId: "user-1",
          sessionToken: "token-1",
          impersonating: null,
        }),
    },
    user: {
      findUnique: ({ select }: { select: Row }) =>
        Promise.resolve(
          "userHashKey" in select
            ? { userHashKey: null }
            : {
                id: "user-1",
                name: "Alex",
                email: STORED_ADDRESS,
                emailVerified: true,
                image: null,
                pendingSsoSetup: false,
                createdAt: new Date(0),
                updatedAt: new Date(0),
                lastLoginAt: null,
                deactivatedAt: null,
              },
        ),
    },
    identifier: {
      findMany: () =>
        Promise.resolve([
          {
            id: "identifier_1",
            userId: "user-1",
            provider: "email",
            value: IDENTIFIER_ADDRESS,
            domain: "identifiers.test",
            identifierHash: null,
            accountId: null,
            providerId: null,
            issuer: null,
            providerAccountId: null,
            state: "PRIMARY",
            connectionId: null,
            verifiedAt: new Date(0),
            attachedAt: new Date(0),
            detachedAt: null,
          },
        ]),
    },
    systemMigrationTenantState: {
      findFirst: () => Promise.resolve(options.finalized ? { tenantId: "user-1" } : null),
      findUnique: () => Promise.resolve(options.finalized ? { status: "finalized" } : null),
    },
  } as Record<string, unknown>;
  const refusing = new Proxy({}, { get: () => refuse });
  const guarded = new Proxy(client, {
    get: (target, key: string) => (key in target ? target[key] : refusing),
  });
  return PrismaConnection.create({ client: guarded as never, pool: guarded as never });
}

class RecordingAuthAbsence extends ApiAuthAbsenceReportPort {
  readonly reasons: string[] = [];

  absent(reason: "no-database" | "no-tenancy" | "no-browser-session-transport"): void {
    this.reasons.push(reason);
  }
}

function composeAuth(options: { finalized: boolean }) {
  const sessions = new TestSessionTransport();
  const composition = ApiAuthComposition.compose({
    database: stubConnection({ finalized: options.finalized }),
    organizations: new Proxy(OrganizationService.prototype, {}),
    browserSessions: sessions,
    processName: "langwatch-api",
  });
  return { composition, sessions };
}

class TestSessionTransport extends ApiBrowserSessionTransportPort {
  async tryResolveVerifiedSession(): Promise<VerifiedBrowserSession | null> {
    return verified;
  }
}

describe("ApiAuthComposition", () => {
  describe("given the process holds everything the Auth graph reads through", () => {
    /** @scenario "The API process composes its own Auth service" */
    it("pairs the Auth service it built with the supplied transport", () => {
      const { composition, sessions } = composeAuth({ finalized: false });

      const dependencies = composition.compose();

      expect(dependencies.sessions).toBe(sessions);
      expect(dependencies.auth).toBeInstanceOf(AuthService);
    });

    /** @scenario "A finalized user's session carries their identifier address" */
    it("answers a finalized user's session with the identifier address", async () => {
      const { composition } = composeAuth({ finalized: true });

      const session = await composition.compose().auth.tryResolveBrowserSession({ verified });

      expect(session?.user.email).toBe(IDENTIFIER_ADDRESS);
    });

    /** @scenario "An unenrolled user's session carries the stored column" */
    it("answers an unenrolled user's session with the stored column", async () => {
      const { composition } = composeAuth({ finalized: false });

      const session = await composition.compose().auth.tryResolveBrowserSession({ verified });

      expect(session?.user.email).toBe(STORED_ADDRESS);
    });
  });

  describe("given a collaborator this process does not hold", () => {
    /** @scenario "A process with no database composes no Auth service" */
    it("composes nothing without a database, and says which half is missing", () => {
      const report = new RecordingAuthAbsence();

      const composed = ApiAuthComposition.tryCompose({
        database: undefined,
        organizations: new Proxy(OrganizationService.prototype, {}),
        browserSessions: new TestSessionTransport(),
        processName: "langwatch-api",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-database"]);
    });

    /** @scenario "A process with no organization service composes no Auth service" */
    it("composes nothing without an organization service, and says so", () => {
      const report = new RecordingAuthAbsence();

      const composed = ApiAuthComposition.tryCompose({
        database: stubConnection({ finalized: false }),
        organizations: undefined,
        browserSessions: new TestSessionTransport(),
        processName: "langwatch-api",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-tenancy"]);
    });

    /** @scenario "A process with no browser-session transport mounts no product transports" */
    it("composes nothing without the deployment's Better Auth transport", () => {
      const report = new RecordingAuthAbsence();

      const composed = ApiAuthComposition.tryCompose({
        database: stubConnection({ finalized: false }),
        organizations: new Proxy(OrganizationService.prototype, {}),
        browserSessions: undefined,
        processName: "langwatch-api",
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-browser-session-transport"]);
    });
  });
});

describe("the avatar storage of a process that composes no stored objects", () => {
  /** @scenario "An avatar upload refuses by name on a process with no stored objects" */
  it("refuses the write and names the process", async () => {
    const storage = UnavailableApiUserAvatarStorageAdapter.create({
      processName: "langwatch-api",
    });

    await expect(
      storage.store({
        projectId: "project-1",
        userId: "user-1",
        mediaType: "image/png",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/langwatch-api composes no stored-object application/);
  });
});

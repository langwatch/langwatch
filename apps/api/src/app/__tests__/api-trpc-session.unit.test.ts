/**
 * The api's tRPC door reads sessions through the auth module's own lookup
 * (spec: verified-session-on-request-context.feature). Left unwired it stays
 * mounted, refusing signed-in callers as "signed out" — pinned to the REST door's answers.
 */
import type { BrowserSessionApi, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { authzTrpcTransport } from "@langwatch/authz-server";
import { AuthzApi } from "@langwatch/authz-contract";
import type { DependencyToken, TransportPeers } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import { ApiTrpcHost } from "../../app-trpc/api-trpc.host.ts";
import { composeApiTrpcSession } from "../api-auth.composition.ts";

const VERIFIED: VerifiedBrowserSession = {
  session: { id: "auth-session-1", expiresAt: new Date("2027-01-01T00:00:00Z") },
  user: { id: "user-1", name: "Person", email: "person@example.com" },
};

const RESOLVED = {
  user: {
    id: "user-1",
    name: "Person",
    email: "person@example.com",
    image: null,
    pendingSsoSetup: false,
  },
  expires: "2027-01-01T00:00:00.000Z",
  sessionId: "auth-session-1",
};

function authStub(overrides: Partial<BrowserSessionApi> = {}): BrowserSessionApi {
  return {
    tryVerifyBrowserSession: async () => VERIFIED,
    tryResolveBrowserSession: async () => RESOLVED,
    revokeAllBrowserSessions: async () => void 0,
    revokeBrowserSession: async () => void 0,
    revokeOtherBrowserSessions: async () => void 0,
    ...overrides,
  };
}

function trpcDoor({ auth, authz }: { auth: BrowserSessionApi; authz: typeof authzService }) {
  const peers: TransportPeers = {
    app: <Instance>(token: DependencyToken<Instance>): Instance => {
      if (token === (AuthzApi as unknown as DependencyToken<Instance>)) {
        return authz as unknown as Instance;
      }
      throw new Error(`unexpected peer: ${String(token)}`);
    },
    find: () => undefined,
  };

  const door = ApiTrpcHost.create({
    peers,
    config: {
      browserSession: composeApiTrpcSession({ auth }),
      logger: { warn: () => void 0, error: () => void 0 },
    },
  });

  return door.door({ authz: door.mount(authzTrpcTransport, () => authz) });
}

const authzService = {
  getDecision: async () => ({ allowed: true }) as never,
  getProjectAnyDecision: async () => ({ allowed: true }) as never,
  checkScopeLineage: async () => ({ kind: "consistent" }) as never,
  effectivePermissionsFor: async () => ({ permissions: ["project:view"] }) as never,
};

const PROCEDURE_PATH =
  "/api/trpc/authz.effectivePermissions?input=" +
  encodeURIComponent(JSON.stringify({ json: { projectId: "project-1" } }));

describe("given the tRPC door reads sessions through the auth module", () => {
  describe("when a verified browser session asks a declared procedure", () => {
    /** @scenario "A verified browser session reaches the surfaces that render the person" */
    it("answers instead of refusing the caller as anonymous", async () => {
      const effectivePermissionsFor = vi
        .fn()
        .mockResolvedValue({ permissions: ["project:view"] });
      const response = await trpcDoor({
        auth: authStub(),
        authz: { ...authzService, effectivePermissionsFor: effectivePermissionsFor as never },
      }).request(PROCEDURE_PATH, { headers: { cookie: "better-auth.session_token=t" } });

      expect(response.status).toBe(200);
      expect(effectivePermissionsFor).toHaveBeenCalledWith(expect.anything(), { id: "user-1" });
    });
  });

  describe("when an administrator is acting as another person", () => {
    /** @scenario "An impersonated session reaches the surface as the impersonated person" */
    it("hands the surface the impersonated person with the administrator beside them", async () => {
      const resolver = composeApiTrpcSession({
        auth: authStub({
          tryResolveBrowserSession: async () => ({
            ...RESOLVED,
            user: {
              id: "customer-1",
              name: "Customer",
              email: "customer@example.com",
              image: null,
              pendingSsoSetup: false,
              impersonator: {
                id: "admin-1",
                name: "Admin",
                email: "admin@example.com",
                image: null,
              },
            },
          }),
        }),
      });

      const session = await resolver(
        new Request("https://app.example.test/api/trpc/organization.getAll"),
      );

      expect(session?.user.id).toBe("customer-1");
      expect(session?.user.impersonator?.id).toBe("admin-1");
    });
  });

  describe("when a request carries no resolvable browser session", () => {
    /** @scenario "An anonymous caller stays refused by the same surface" */
    it("refuses the caller and never asks the service", async () => {
      const effectivePermissionsFor = vi.fn();
      const response = await trpcDoor({
        auth: authStub({ tryVerifyBrowserSession: async () => null }),
        authz: { ...authzService, effectivePermissionsFor: effectivePermissionsFor as never },
      }).request(PROCEDURE_PATH);

      expect(response.status).toBe(401);
      expect(effectivePermissionsFor).not.toHaveBeenCalled();
    });
  });

  describe("when a cookie verifies but no live session stands behind it", () => {
    it("treats the caller as anonymous rather than half signed in", async () => {
      const resolver = composeApiTrpcSession({
        auth: authStub({ tryResolveBrowserSession: async () => null }),
      });

      const session = await resolver(
        new Request("https://app.example.test/api/trpc/organization.getAll"),
      );

      expect(session).toBeNull();
    });
  });
});

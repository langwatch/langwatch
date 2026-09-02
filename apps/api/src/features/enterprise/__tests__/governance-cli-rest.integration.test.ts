/**
 * The CLI governance plane through the real Hono app this process mounts, over
 * fakes at every port.
 *
 * What is pinned is the GATE CHAIN, because every link of it is a control
 * rather than a convenience, and their ORDER is the contract:
 *
 *   bearer (401) → plan (402) → permission (403) → the read
 *
 * A bearer only proves organization membership, so a permission check that ran
 * first would still be correct but would tell a free-tier caller which
 * permissions they lack on a capability they cannot have at all; and a plan
 * check that ran after the read would have already answered Enterprise data to
 * a tenant that never bought it. The 402 also carries the upgrade URL inline,
 * so the CLI renders an actionable upsell without a second call.
 *
 * The credential-handing route pins the fourth link: current, active
 * membership, re-derived from rows rather than trusted from a token that was
 * cryptographically fine when it was minted — and the presented session is
 * severed on the way out, so an offboarded caller stops authenticating
 * immediately rather than at the next hourly expiry.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type {
  GovernanceCliCaller,
  GovernanceCliRestPorts,
} from "@langwatch/enterprise-governance-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";

const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";
const BEARER = "Bearer lw_at_valid";

describe("given a device session reading the Activity Monitor's sources", () => {
  describe("when the caller is on Enterprise and holds the permission", () => {
    it("answers the organization's live sources", async () => {
      const world = governanceCliWorld();
      const api = mount(world);

      const response = await api.get("/api/auth/cli/governance/ingest/sources", BEARER);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        sources: [
          {
            id: "src-1",
            name: "Claude Code",
            sourceType: "claude_code",
            description: null,
            status: "ACTIVE",
            lastEventAt: null,
            createdAt: "2026-09-01T00:00:00.000Z",
            archivedAt: null,
          },
        ],
      });
      expect(world.permissionProbes).toEqual(["ingestionSources:view"]);
    });
  });

  describe("when the caller's organization is not on Enterprise", () => {
    it("answers 402 with the upgrade link, before any permission is probed", async () => {
      const world = governanceCliWorld({ planType: "FREE" });
      const api = mount(world);

      const response = await api.get("/api/auth/cli/governance/ingest/sources", BEARER);

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        error: "payment_required",
        error_description: "Ingestion sources require an Enterprise plan",
        upgrade_url: "https://app.test/settings/subscription",
      });
      expect(world.permissionProbes).toEqual([]);
      expect(world.sourceListReads).toBe(0);
    });
  });

  describe("when an Enterprise member lacks the governance permission", () => {
    it("answers 403 and never reads a source", async () => {
      const world = governanceCliWorld({ permitted: false });
      const api = mount(world);

      const response = await api.get("/api/auth/cli/governance/ingest/sources", BEARER);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "forbidden",
        error_description:
          "Missing required permission 'ingestionSources:view' on this organization",
      });
      expect(world.sourceListReads).toBe(0);
    });
  });

  describe("when the bearer is missing or malformed", () => {
    it("answers 401 before the plan is looked up", async () => {
      const world = governanceCliWorld();
      const api = mount(world);

      const response = await api.get("/api/auth/cli/governance/ingest/sources");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "unauthorized",
        error_description: "Bearer access token is missing, malformed, or expired",
      });
      expect(world.planReads).toBe(0);
    });
  });
});

describe("given a device session asking for a project's key", () => {
  describe("when the caller was offboarded after the token was minted", () => {
    it("refuses and severs the presented session rather than waiting for it to expire", async () => {
      const world = governanceCliWorld({ activeMembership: false });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/project-key",
        { slug: "shared" },
        BEARER,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "forbidden",
        error_description:
          "Your access to this organization has ended. Run `langwatch login` to sign in again.",
      });
      expect(world.revokedSessions).toEqual([USER_ID]);
    });
  });

  describe("when an active member without project write asks for the key", () => {
    it("answers 403 rather than handing back the shared write credential", async () => {
      const world = governanceCliWorld({ permitted: false });
      const api = mount(world);

      const response = await api.post(
        "/api/auth/cli/project-key",
        { slug: "shared" },
        BEARER,
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "forbidden",
        error_description: "You need write access to this project to retrieve its API key.",
      });
    });
  });
});

// --------------------------------------------------------------------------

function governanceCliWorld(
  options: {
    planType?: string;
    permitted?: boolean;
    activeMembership?: boolean;
  } = {},
) {
  const world = {
    permissionProbes: [] as string[],
    revokedSessions: [] as string[],
    sourceListReads: 0,
    planReads: 0,
    ports: undefined as unknown as GovernanceCliRestPorts,
  };

  const caller: GovernanceCliCaller = {
    user_id: USER_ID,
    organization_id: ORGANIZATION_ID,
  };

  const database = {
    user: {
      findUnique: () =>
        Promise.resolve({
          deactivatedAt: null,
          name: "Bob",
          email: "bob@example.test",
        }),
    },
    organizationUser: {
      findFirst: () =>
        Promise.resolve(options.activeMembership === false ? null : { userId: USER_ID }),
    },
    project: {
      findFirst: () =>
        Promise.resolve({
          id: "project-shared",
          slug: "shared",
          name: "Shared",
          apiKey: "shared-key",
          isPersonal: false,
          ownerUserId: null,
        }),
    },
    organization: { findUnique: () => Promise.resolve({ supportContact: null }) },
  };

  world.ports = {
    accessTokens: {
      resolve: (authHeader) =>
        Promise.resolve(authHeader === BEARER ? caller : null),
      revoke: (input) => {
        world.revokedSessions.push(input.userId);
        return Promise.resolve();
      },
    },
    governance: () =>
      ({
        ingestionSourceList: () => {
          world.sourceListReads += 1;
          return Promise.resolve([
            {
              id: "src-1",
              name: "Claude Code",
              sourceType: "claude_code",
              description: null,
              status: "ACTIVE",
              lastEventAt: null,
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
              archivedAt: null,
            },
          ]);
        },
      }) as never,
    database: () => database as never,
    ensurePersonalWorkspace: () => {
      throw new Error("unreachable in these scenarios");
    },
    tryFindPersonalWorkspace: () => Promise.resolve(null),
    plans: () =>
      ({
        getActivePlan: () => {
          world.planReads += 1;
          return Promise.resolve({ type: options.planType ?? "ENTERPRISE" });
        },
      }) as never,
    permittedOnOrganization: ({ permission }) => {
      world.permissionProbes.push(permission);
      return Promise.resolve(options.permitted !== false);
    },
    permittedOnProject: () => Promise.resolve(options.permitted !== false),
    publicBaseUrl: "https://app.test",
  };

  return world;
}

function mount(world: ReturnType<typeof governanceCliWorld>) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the governance CLI family resolves its own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      governanceCli: world.ports,
    },
  })) {
    hono.route("/", app);
  }

  const fetchAt = (path: string, init?: RequestInit) =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    get: (path: string, authorization?: string) =>
      fetchAt(path, authorization ? { headers: { authorization } } : undefined),
    post: (path: string, body: unknown, authorization?: string) =>
      fetchAt(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      }),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

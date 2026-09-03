/**
 * Characterisation of the four Langy REST doors through the real Hono apps the
 * API process mounts, over fakes at every port.
 *
 * What is pinned here is the REFUSAL ORDER, because it is the part a rewrite
 * silently breaks. On the public doors: a missing credential answers 401 before
 * anything reads a project; a project the rollout has not reached answers Hono's
 * own plain-text 404, byte-identical to an unmounted path, so a dark surface
 * cannot be probed; and the ceiling is checked AFTER that 404 and — on the
 * UI-action door — after the dispatched kind is known, so the refusal names the
 * real problem. On the internal doors: an unconfigured secret answers 503 rather
 * than falling open, a wrong bearer answers 401, and a turn triple that does not
 * exist answers 404 without confirming which half of it was wrong.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  createLangyInternalRestApp,
  createLangyRelayRestApp,
  createLangyTurnsRestApp,
  createLangyUiActionsRestApp,
  type LangyRestCredentialPorts,
} from "@langwatch/langy-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { apiLangyRestMetrics, composeApiLangyRest } from "../langy-rest.mount";

const KEY = { "x-auth-token": "lw_key" };

describe("given the public Langy turn door", () => {
  describe("when a project key starts a turn on an open project", () => {
    it("answers 202 with the turn ids and stamps the key as used", async () => {
      const world = langyWorld();
      const api = mountTurns(world);

      const response = await api.fetch("/api/langy/conversations", {
        method: "POST",
        headers: KEY,
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], idempotencyKey: "k1" }),
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({
        conversationId: "conv_1",
        turnId: "turn_1",
      });
      expect(world.markedUsed).toBe(true);
      expect(world.started[0]).toMatchObject({
        projectId: "project_1",
        idempotencyKey: "k1",
        session: { user: { id: "user_1" } },
      });
    });
  });

  describe("when the surface is dark for that project", () => {
    it("answers Hono's own plain-text 404, not the canonical envelope", async () => {
      const world = langyWorld({ flagOpen: false });
      const api = mountTurns(world);

      const response = await api.fetch("/api/langy/conversations", {
        method: "POST",
        headers: KEY,
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], idempotencyKey: "k1" }),
      });

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("404 Not Found");
      expect(world.ceilingChecks).toEqual([]);
      expect(world.started).toEqual([]);
    });
  });

  describe("when no credential is presented", () => {
    it("answers 401 before any project is read", async () => {
      const world = langyWorld();
      const api = mountTurns(world);

      const response = await api.fetch("/api/langy/conversations", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], idempotencyKey: "k1" }),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "langy_api_credential_missing",
      });
      expect(world.flagReads).toEqual([]);
    });
  });

  describe("when the key lacks the turn permission", () => {
    it("answers the ceiling's own refusal and starts nothing", async () => {
      const world = langyWorld({ ceilingDenied: true });
      const api = mountTurns(world);

      const response = await api.fetch("/api/langy/conversations", {
        method: "POST",
        headers: KEY,
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], idempotencyKey: "k1" }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "api_key_permission_denied" });
      expect(world.ceilingChecks).toEqual(["langy:create"]);
      expect(world.started).toEqual([]);
    });
  });
});

describe("given the agent-to-page UI-action door", () => {
  describe("when the dispatched kind is not in this process's catalogue", () => {
    it("refuses by kind BEFORE the ceiling, so the error names the real problem", async () => {
      const world = langyWorld();
      const api = mountUiActions(world);

      const response = await api.fetch("/api/langy/ui/actions", {
        method: "POST",
        headers: KEY,
        body: JSON.stringify({ conversationId: "conv_1", kind: "workbench.setCell" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "langy_ui_action_unknown",
      });
      expect(world.ceilingChecks).toEqual([]);
    });
  });

  describe("when an agent asks what it may dispatch", () => {
    it("answers an empty catalogue rather than one this process cannot run", async () => {
      const world = langyWorld();
      const api = mountUiActions(world);

      const response = await api.fetch("/api/langy/ui/actions", { headers: KEY });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ actions: [] });
    });
  });
});

describe("given the internal Langy control plane", () => {
  describe("when the deployment configured no shared secret", () => {
    it("answers 503 rather than letting the bearer gate fall open", async () => {
      const world = langyWorld({ internalSecret: undefined });
      const api = mountInternal(world);

      const response = await api.fetch("/api/internal/langy/credentials/revoke", {
        method: "POST",
        body: JSON.stringify({ apiKeyId: "key_1", projectId: "project_1" }),
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "Not configured" });
    });
  });

  describe("when the bearer does not match", () => {
    it("answers 401 without reaching the application", async () => {
      const world = langyWorld();
      const api = mountInternal(world);

      const response = await api.fetch("/api/internal/langy/credentials/revoke", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret-of-same-len" },
        body: JSON.stringify({ apiKeyId: "key_1", projectId: "project_1" }),
      });

      expect(response.status).toBe(401);
      expect(world.revoked).toEqual([]);
    });
  });

  describe("when the agent posts a final for a turn that does not exist", () => {
    it("answers 404 without ingesting, so a probe confirms no cross-tenant id", async () => {
      const world = langyWorld({ turnExists: false });
      const api = mountInternal(world);

      const response = await api.fetch("/api/internal/langy/turn/turn_1/result", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({
          projectId: "project_1",
          conversationId: "conv_1",
          status: "completed",
          text: "done",
        }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "turn not found" });
      expect(world.ingested).toEqual([]);
    });
  });

  describe("when the agent posts a final for a turn that does exist", () => {
    it("answers 202 and ingests it once", async () => {
      const world = langyWorld();
      const api = mountInternal(world);

      const response = await api.fetch("/api/internal/langy/turn/turn_1/result", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({
          projectId: "project_1",
          conversationId: "conv_1",
          status: "completed",
          text: "done",
        }),
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ status: "accepted" });
      expect(world.ingested).toEqual([
        { projectId: "project_1", conversationId: "conv_1", turnId: "turn_1", status: "completed" },
      ]);
    });
  });
});

describe("given the Langy relay", () => {
  describe("when the process holds no live buffer", () => {
    it("refuses with 503 rather than accepting frames nothing can read back", async () => {
      const world = langyWorld();
      const hono = new Hono().route(
        "/",
        createLangyRelayRestApp({
          security: passThroughSecurity(),
          ports: {
            langy: () => world.langy,
            hasLiveBuffer: () => false,
            internalSecret: () => SECRET,
            metrics: { frames: () => {} },
          },
        }),
      );

      const response = await hono.fetch(
        new Request("http://api.test/api/internal/langy/relay/frames", {
          method: "POST",
          headers: { authorization: `Bearer ${SECRET}` },
          body: "{}\n",
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "streaming unavailable" });
    });
  });
});

describe("given a process composing the Langy doors", () => {
  describe("when it holds no Redis", () => {
    it("composes the turn and internal doors and leaves the two Redis-only ones out", () => {
      const world = langyWorld();
      const composed = composeApiLangyRest({
        langy: world.langy,
        apiKeys: world.apiKeys,
        featureFlags: world.featureFlags,
        actors: world.actors,
        enforceCeiling: world.enforceCeiling,
        redis: undefined,
        internalSecret: SECRET,
        metrics: apiLangyRestMetrics(),
      });

      expect(composed?.turns).toBeDefined();
      expect(composed?.internal).toBeDefined();
      expect(composed?.uiActions).toBeUndefined();
      expect(composed?.relay).toBeUndefined();
    });
  });

  describe("when it holds no Langy application", () => {
    it("composes nothing at all", () => {
      const world = langyWorld();
      expect(
        composeApiLangyRest({
          langy: undefined,
          apiKeys: world.apiKeys,
          featureFlags: world.featureFlags,
          actors: world.actors,
          enforceCeiling: world.enforceCeiling,
          redis: undefined,
          internalSecret: SECRET,
          metrics: apiLangyRestMetrics(),
        }),
      ).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// The world every door is driven against.
// ---------------------------------------------------------------------------

const SECRET = "langy-internal-secret-value";

class ApiKeyPermissionDenied extends HandledError {
  constructor(permission: string) {
    super("api_key_permission_denied", `This API key may not ${permission}.`, {
      httpStatus: 403,
      fault: "customer",
    });
  }
}

function langyWorld(
  options: {
    flagOpen?: boolean;
    ceilingDenied?: boolean;
    turnExists?: boolean;
    internalSecret?: string | undefined;
  } = {},
) {
  const started: unknown[] = [];
  const ingested: unknown[] = [];
  const revoked: unknown[] = [];
  const ceilingChecks: string[] = [];
  const flagReads: string[] = [];
  const world = {
    started,
    ingested,
    revoked,
    ceilingChecks,
    flagReads,
    markedUsed: false,
    internalSecret: "internalSecret" in options ? options.internalSecret : SECRET,
    langy: {
      langyService: {
        startConversationTurn: async (input: unknown) => {
          started.push(input);
          return { conversationId: "conv_1", turnId: "turn_1" };
        },
        turnExists: async () => options.turnExists ?? true,
        ingestAgentTurnResult: async (input: {
          projectId: string;
          conversationId: string;
          turnId: string;
          status: string;
        }) => {
          ingested.push({
            projectId: input.projectId,
            conversationId: input.conversationId,
            turnId: input.turnId,
            status: input.status,
          });
        },
        revokeWorkerSessionKey: async (input: unknown) => {
          revoked.push(input);
          return "revoked" as const;
        },
        openRelayConnection: () => ({ pinnedTurn: null, handle: async () => ({ status: "applied" }) }),
      },
      tryFindVisible: async () => null,
    } as never,
    apiKeys: {
      tryResolveToken: async () => resolvedKey(),
      markUsed: () => {
        world.markedUsed = true;
      },
    } as never,
    featureFlags: {
      isEnabled: async (flag: string) => {
        flagReads.push(flag);
        return options.flagOpen ?? true;
      },
    } as never,
    actors: {
      user: {
        findUnique: async () => ({ id: "user_1", name: "Ada", email: "ada@example.com" }),
      },
    } as never,
    enforceCeiling: async ({
      permission,
    }: {
      resolved: ResolvedApiKeyToken;
      permission: string;
    }) => {
      ceilingChecks.push(permission);
      if (options.ceilingDenied) throw new ApiKeyPermissionDenied(permission);
    },
  };
  return world;
}

function resolvedKey() {
  return {
    type: "apiKey" as const,
    apiKeyId: "key_1",
    userId: "user_1",
    organizationId: "org_1",
    isLangySessionKey: false,
    project: { id: "project_1", slug: "p", teamId: "team_1", organizationId: "org_1" },
  };
}

function credentialPorts(world: ReturnType<typeof langyWorld>): LangyRestCredentialPorts {
  return {
    readCredential: (request) => {
      const token = request.headers.get("x-auth-token");
      return token ? { token, projectId: null } : null;
    },
    apiKeys: () => world.apiKeys,
    enforceCeiling: world.enforceCeiling as LangyRestCredentialPorts["enforceCeiling"],
    featureFlags: () => world.featureFlags,
    actors: () => world.actors,
  };
}

function mountTurns(world: ReturnType<typeof langyWorld>) {
  const hono = new Hono().route(
    "/",
    createLangyTurnsRestApp({
      security: passThroughSecurity(),
      ports: { ...credentialPorts(world), langy: () => world.langy, redis: () => null },
    }),
  );
  return honoFetch(hono);
}

function mountUiActions(world: ReturnType<typeof langyWorld>) {
  const composed = composeApiLangyRest({
    langy: world.langy,
    apiKeys: world.apiKeys,
    featureFlags: world.featureFlags,
    actors: world.actors,
    enforceCeiling: world.enforceCeiling,
    // Any object satisfies the structural Redis port; the two routes under test
    // refuse before the channel is ever touched.
    redis: {} as never,
    internalSecret: world.internalSecret,
    metrics: apiLangyRestMetrics(),
  });
  if (!composed?.uiActions) throw new Error("the UI-action door did not compose");
  const hono = new Hono().route(
    "/",
    createLangyUiActionsRestApp({
      security: passThroughSecurity(),
      ports: { ...composed.uiActions, ...credentialPorts(world) },
    }),
  );
  return honoFetch(hono);
}

function mountInternal(world: ReturnType<typeof langyWorld>) {
  const hono = new Hono().route(
    "/",
    createLangyInternalRestApp({
      security: passThroughSecurity(),
      ports: {
        langy: () => world.langy,
        internalSecret: () => world.internalSecret,
        metrics: { turnResult: () => {}, sessionKeyRevokeRefused: () => {} },
      },
    }),
  );
  return honoFetch(hono);
}

function honoFetch(hono: Hono) {
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/**
 * Renders a handled error the way the process's canonical boundary does, so
 * the status and code a refusal carries are what the assertions read rather
 * than a blanket 500.
 */
const renderCanonical: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { code: error.code, message: error.message },
      error.httpStatus as 400 | 401 | 403 | 404 | 500,
    );
  }
  return c.json({ error: String(error) }, 500);
};

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
    legacyErrorHandler: renderCanonical,
    canonicalErrorHandler: renderCanonical,
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

// The relay logs a warn on a closed stream; the doors log an error when the
// secret is unset. Both are deliberate and neither is under test here.
vi.spyOn(console, "error").mockImplementation(() => {});

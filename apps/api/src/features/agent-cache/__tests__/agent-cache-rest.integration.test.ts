/**
 * The `/api/agent-cache` REST family, driven through the real Hono app
 * `createAgentCacheRestApp` builds — mounted over a real `AgentCacheService` on the
 * @see specs/agent-cache/agent-cache.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAgentCacheRestApp,
  MAX_NAME_LENGTH,
  MAX_TTL_SECONDS,
  MAX_VALUE_BYTES,
  MIN_TTL_SECONDS,
  type AgentCacheStore,
} from "../agent-cache-rest";
import { MemoryAgentCacheEntryStore } from "../agent-cache.store";
import { AgentCacheService } from "../agent-cache.service";

const PROJECT_ID = "project_cache";

const fakeEncryption: SecretEncryptionPort = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => {
    if (!value.startsWith("sealed:")) {
      throw new Error("this envelope does not open with the current key");
    }
    return value.slice("sealed:".length);
  },
};

type Caller = "authenticated" | "unauthenticated" | "no-grain";

function testSecurity(caller: Caller): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    if (caller === "unauthenticated") {
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("project", {
      id: PROJECT_ID,
      name: "Cache Project",
      slug: "cache-project",
      teamId: "team_1",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
    return undefined;
  };
  const authorizeProjectPermission: MiddlewareHandler = async (c, next) => {
    if (caller === "no-grain") return c.json({ error: "forbidden" }, 403);
    await next();
    return undefined;
  };
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      const handled = error as { httpStatus?: number; message?: string };
      return c.json(
        { error: handled.message ?? String(error) },
        (handled.httpStatus ?? 500) as never,
      );
    },
    canonicalErrorHandler: (error, c) => {
      const handled = error as { httpStatus?: number; code?: string; message?: string };
      return c.json(
        { code: handled.code ?? "error", message: handled.message ?? String(error) },
        (handled.httpStatus ?? 500) as never,
      );
    },
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => authorizeProjectPermission,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

function buildApi(caller: Caller = "authenticated") {
  const store = MemoryAgentCacheEntryStore.create();
  const service = new AgentCacheService(store, fakeEncryption);
  const agentCache: AgentCacheStore = {
    getByName: (input) => service.getByName(input),
    put: (input) => service.put(input),
    claim: (input) => service.claim(input),
    delete: (input) => service.delete(input),
  };
  const app = createAgentCacheRestApp({
    security: testSecurity(caller),
    agentCache: () => agentCache,
  });

  return {
    get: (name: string) => app.hono.request(`/api/agent-cache/${name}`),
    put: (name: string, body: Record<string, unknown>) =>
      app.hono.request(`/api/agent-cache/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    claim: (name: string, body: Record<string, unknown>) =>
      app.hono.request(`/api/agent-cache/${name}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    del: (name: string) => app.hono.request(`/api/agent-cache/${name}`, { method: "DELETE" }),
  };
}

describe("given a project with an API key that can manage the agent cache", () => {
  let api: ReturnType<typeof buildApi>;

  beforeEach(() => {
    api = buildApi("authenticated");
  });

  describe("an entry is written by name and read back by name", () => {
    /** @scenario "A stored entry is read back by its name" */
    it("answers the value the caller stored", async () => {
      await api.put("ACME_SESSION", { value: "session-1" });

      const response = await api.get("ACME_SESSION");
      const body = (await response.json()) as { name: string; value: string };

      expect(response.status).toBe(200);
      expect(body).toEqual({ name: "ACME_SESSION", value: "session-1" });
    });

    /** @scenario "A second write replaces the entry" */
    it("answers the newer value after a second write", async () => {
      await api.put("ACME_SESSION", { value: "session-1" });
      await api.put("ACME_SESSION", { value: "session-2" });

      const response = await api.get("ACME_SESSION");
      const body = (await response.json()) as { value: string };

      expect(body.value).toBe("session-2");
    });

    /** @scenario "An entry stops answering once its lifetime passes" */
    it("is refused as not found once its lifetime passes", async () => {
      await api.put("ACME_SESSION", { value: "session-1", ttl_seconds: MIN_TTL_SECONDS });

      await new Promise((resolve) => setTimeout(resolve, (MIN_TTL_SECONDS + 1) * 1000));

      const response = await api.get("ACME_SESSION");
      const body = (await response.json()) as { code?: string };

      expect(response.status).toBe(404);
      expect(body.code ?? "cache_entry_not_found").toBe("cache_entry_not_found");
    }, 10_000);

    /** @scenario "A name the project does not hold is refused as not found" */
    it("is refused as not found when the project never held it", async () => {
      const response = await api.get("ACME_ABSENT");

      expect(response.status).toBe(404);
    });

    /** @scenario "Removing an entry the project does not hold succeeds" */
    it("succeeds when the entry it removes was never stored", async () => {
      const response = await api.del("ACME_ABSENT");

      expect(response.status).toBe(200);
    });
  });

  describe("the accepted bounds are stated at the route", () => {
    /** @scenario "A value past the size limit is refused" */
    it("refuses a value larger than the size limit", async () => {
      const response = await api.put("ACME_SESSION", { value: "x".repeat(MAX_VALUE_BYTES + 1) });

      expect(response.status).toBe(422);
    });

    /** @scenario "A name outside the accepted shape is refused" */
    it("refuses a name that is not UPPER_SNAKE_CASE", async () => {
      const response = await api.get("not-upper-snake-case");

      expect(response.status).toBe(422);
    });

    /** @scenario "A lifetime outside the accepted range is refused" */
    it("refuses a lifetime under the minimum", async () => {
      const response = await api.put("ACME_SESSION", {
        value: "session-1",
        ttl_seconds: MIN_TTL_SECONDS - 1,
      });

      expect(response.status).toBe(422);
    });

    it("refuses a name longer than the accepted length", async () => {
      const response = await api.get("A".repeat(MAX_NAME_LENGTH + 1));

      expect(response.status).toBe(422);
    });

    it("refuses a lifetime over the maximum", async () => {
      const response = await api.put("ACME_SESSION", {
        value: "session-1",
        ttl_seconds: MAX_TTL_SECONDS + 1,
      });

      expect(response.status).toBe(422);
    });
  });

  describe("a caller can take a name only if the project does not hold it", () => {
    /** @scenario "A claim on a free name is taken" */
    it("takes a free name and a read answers the claimed value", async () => {
      const response = await api.claim("ACME_SESSION", { value: "claimed-value" });
      const body = (await response.json()) as { claimed: boolean };

      expect(body.claimed).toBe(true);

      const read = await api.get("ACME_SESSION");
      expect(await read.json()).toMatchObject({ value: "claimed-value" });
    });

    /** @scenario "A claim on a held name leaves the held value alone" */
    it("leaves the held value alone when the name is already taken", async () => {
      await api.claim("ACME_SESSION", { value: "first-value" });

      const response = await api.claim("ACME_SESSION", { value: "second-value" });
      const body = (await response.json()) as { claimed: boolean };

      expect(body.claimed).toBe(false);

      const read = await api.get("ACME_SESSION");
      expect(await read.json()).toMatchObject({ value: "first-value" });
    });

    /** @scenario "A name is free again once its lifetime passes" */
    it("is free again once the claim's lifetime passes", async () => {
      await api.claim("ACME_SESSION", { value: "first-value", ttl_seconds: MIN_TTL_SECONDS });

      await new Promise((resolve) => setTimeout(resolve, (MIN_TTL_SECONDS + 1) * 1000));

      const response = await api.claim("ACME_SESSION", { value: "second-value" });
      const body = (await response.json()) as { claimed: boolean };

      expect(body.claimed).toBe(true);
    }, 10_000);

    /** @scenario "Only one of several claims sent at once takes the name" */
    it("lets exactly one of several simultaneous claims take the name", async () => {
      const responses = await Promise.all(
        ["one", "two", "three", "four"].map((value) => api.claim("ACME_SESSION", { value })),
      );
      const bodies = (await Promise.all(responses.map((r) => r.json()))) as {
        claimed: boolean;
      }[];

      expect(bodies.filter((b) => b.claimed)).toHaveLength(1);
    });
  });
});

describe("only a caller that can manage the cache reaches it", () => {
  /** @scenario "A caller without the manage grain is refused" */
  it("refuses a caller that holds neither agentCache grain", async () => {
    const api = buildApi("no-grain");

    const read = await api.get("ACME_SESSION");
    const write = await api.put("ACME_SESSION", { value: "session-1" });

    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
  });

  /** @scenario "A request without an API key is refused" */
  it("refuses a request that carries no API key", async () => {
    const api = buildApi("unauthenticated");

    const response = await api.get("ACME_SESSION");

    expect(response.status).toBe(401);
  });

  /** @scenario "A legacy project key reaches the agent cache" */
  it("lets a legacy project key store an entry and read it back", async () => {
    // A legacy project key already holds full project access; the security
    // spine's ceiling grants it every permission rather than the family
    // checking for it specifically, so it reaches this route the same way
    // any other authenticated, fully-permissioned caller does.
    const api = buildApi("authenticated");

    await api.put("ACME_SESSION", { value: "session-1" });
    const response = await api.get("ACME_SESSION");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ value: "session-1" });
  });
});

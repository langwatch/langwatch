/**
 * The agent-cache family through the Gateway installer, process runtime, and
 * production mount.
 * @see specs/agent-cache/agent-cache.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  MAX_AGENT_CACHE_NAME_LENGTH,
  MAX_AGENT_CACHE_TTL_SECONDS,
  MAX_AGENT_CACHE_VALUE_BYTES,
  MIN_AGENT_CACHE_TTL_SECONDS,
} from "@langwatch/gateway-contract/gateway-agent-cache-schemas";
import type { SecretEncryption } from "@langwatch/secret-server";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { composeGatewayAgentCache, installApiGateway } from "../../gateway/gateway.composition.ts";
import { mountGatewayAgentCacheRest } from "../../gateway/gateway-rest.mount.ts";

const PROJECT = {
  id: "project-cache",
  slug: "cache-project",
  teamId: "team-cache",
  organizationId: "organization-cache",
  isPersonal: false,
  ownerUserId: null,
};

const encryption: SecretEncryption = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => {
    if (!value.startsWith("sealed:")) {
      throw new Error("this envelope does not open with the current key");
    }

    return value.slice("sealed:".length);
  },
};

type Caller = "authenticated" | "unauthenticated" | "no-grain";

async function buildApi(caller: Caller = "authenticated") {
  const askedPermissions: AuthzPermission[] = [];
  const errors = ApiRestObservabilityComposition.create().canonicalErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: async ({ permission }) => {
      askedPermissions.push(permission);

      if (caller === "unauthenticated") {
        return { ok: false as const, status: 401 as const, body: { error: "Unauthorized" } };
      }
      if (caller === "no-grain") {
        return { ok: false as const, status: 403 as const, body: { error: "Forbidden" } };
      }

      return {
        ok: true as const,
        project: PROJECT,
        resolved: {
          type: "apiKey" as const,
          apiKeyId: "key-cache",
          userId: null,
          organizationId: PROJECT.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: PROJECT,
        },
        markUsed: () => void 0,
      };
    },
    organizationCredential: () => {
      throw new Error("This suite opens no organization credential door");
    },
    organizationIdentity: () => {
      throw new Error("This suite opens no organization credential door");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors,
  });
  const agentCache = composeGatewayAgentCache({ encryption, redis: void 0 });
  const gateway = await installApiGateway({
    infrastructure: void 0,
    peers: void 0,
    clickhouse: null,
    virtualKeyPepper: void 0,
    agentCache,
  });
  const service = gateway.restServices.agentCache;
  if (!service) throw new Error("The cache infrastructure did not install its REST service");

  const app = mountGatewayAgentCacheRest(runtime, service);
  return {
    askedPermissions,
    get: (name: string, prefix = "/api/agent-cache") => app.request(`${prefix}/${name}`),
    put: (name: string, body: Record<string, unknown>) =>
      app.request(`/api/agent-cache/${name}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    claim: (name: string, body: Record<string, unknown>) =>
      app.request(`/api/agent-cache/${name}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    remove: (name: string) => app.request(`/api/agent-cache/${name}`, { method: "DELETE" }),
  };
}

describe("given a project credential that can manage the agent cache", () => {
  let api: Awaited<ReturnType<typeof buildApi>>;

  beforeEach(async () => {
    api = await buildApi();
  });

  describe("when an entry is written by name", () => {
    /** @scenario "A stored entry is read back by its name" */
    it("answers the value from both published base paths", async () => {
      await api.put("ACME_SESSION", { value: "session-1" });

      const canonical = await api.get("ACME_SESSION");
      const versioned = await api.get("ACME_SESSION", "/api/v1/agent-cache");

      expect(canonical.status).toBe(200);
      await expect(canonical.json()).resolves.toEqual({
        name: "ACME_SESSION",
        value: "session-1",
      });
      expect(versioned.status).toBe(200);
      expect(api.askedPermissions).toEqual([
        "agentCache:manage",
        "agentCache:manage",
        "agentCache:manage",
      ]);
    });

    /** @scenario "A second write replaces the entry" */
    it("answers the newer value after a second write", async () => {
      await api.put("ACME_SESSION", { value: "session-1" });
      await api.put("ACME_SESSION", { value: "session-2" });

      await expect((await api.get("ACME_SESSION")).json()).resolves.toMatchObject({
        value: "session-2",
      });
    });

    /** @scenario "An entry stops answering once its lifetime passes" */
    it("is refused as not found once its lifetime passes", async () => {
      await api.put("ACME_SESSION", {
        value: "session-1",
        ttl_seconds: MIN_AGENT_CACHE_TTL_SECONDS,
      });
      await new Promise((resolve) => setTimeout(resolve, (MIN_AGENT_CACHE_TTL_SECONDS + 1) * 1000));

      const response = await api.get("ACME_SESSION");
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "cache_entry_not_found" },
      });
    }, 10_000);

    /** @scenario "A name the project does not hold is refused as not found" */
    it("is refused as not found when the project never held it", async () => {
      const response = await api.get("ACME_ABSENT");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "cache_entry_not_found" },
      });
    });

    /** @scenario "Removing an entry the project does not hold succeeds" */
    it("succeeds when the entry it removes was never stored", async () => {
      const response = await api.remove("ACME_ABSENT");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ name: "ACME_ABSENT", deleted: true });
    });
  });

  describe("when input is outside the published bounds", () => {
    /** @scenario "A value past the size limit is refused" */
    it("counts UTF-8 bytes when refusing an oversized value", async () => {
      const response = await api.put("ACME_SESSION", {
        value: "é".repeat(MAX_AGENT_CACHE_VALUE_BYTES / 2 + 1),
      });

      expect(response.status).toBe(422);
    });

    /** @scenario "A name outside the accepted shape is refused" */
    it("refuses names outside upper snake case or over the limit", async () => {
      const wrongShape = await api.get("not-upper-snake-case");
      const tooLong = await api.get("A".repeat(MAX_AGENT_CACHE_NAME_LENGTH + 1));

      expect(wrongShape.status).toBe(422);
      expect(tooLong.status).toBe(422);
    });

    /** @scenario "A lifetime outside the accepted range is refused" */
    it("refuses lifetimes below and above the accepted range", async () => {
      const tooShort = await api.put("ACME_SESSION", {
        value: "session-1",
        ttl_seconds: MIN_AGENT_CACHE_TTL_SECONDS - 1,
      });
      const tooLong = await api.put("ACME_SESSION", {
        value: "session-1",
        ttl_seconds: MAX_AGENT_CACHE_TTL_SECONDS + 1,
      });

      expect(tooShort.status).toBe(422);
      expect(tooLong.status).toBe(422);
    });
  });

  describe("when callers claim the same name", () => {
    /** @scenario "A claim on a free name is taken" */
    it("takes a free name and reads back its claimed value", async () => {
      const response = await api.claim("ACME_SESSION", { value: "claimed-value" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ claimed: true });
      await expect((await api.get("ACME_SESSION")).json()).resolves.toMatchObject({
        value: "claimed-value",
      });
    });

    /** @scenario "A claim on a held name leaves the held value alone" */
    it("leaves the held value alone when another claim loses", async () => {
      await api.claim("ACME_SESSION", { value: "first-value" });

      const response = await api.claim("ACME_SESSION", { value: "second-value" });
      await expect(response.json()).resolves.toMatchObject({ claimed: false });
      await expect((await api.get("ACME_SESSION")).json()).resolves.toMatchObject({
        value: "first-value",
      });
    });

    /** @scenario "A name is free again once its lifetime passes" */
    it("takes the name again once the first claim expires", async () => {
      await api.claim("ACME_SESSION", {
        value: "first-value",
        ttl_seconds: MIN_AGENT_CACHE_TTL_SECONDS,
      });
      await new Promise((resolve) => setTimeout(resolve, (MIN_AGENT_CACHE_TTL_SECONDS + 1) * 1000));

      const response = await api.claim("ACME_SESSION", { value: "second-value" });

      await expect(response.json()).resolves.toMatchObject({ claimed: true });
    }, 10_000);

    /** @scenario "Only one of several claims sent at once takes the name" */
    it("lets exactly one simultaneous claim take the name", async () => {
      const responses = await Promise.all(
        ["one", "two", "three", "four"].map((value) => api.claim("ACME_SESSION", { value })),
      );
      const bodies = await Promise.all(responses.map((response) => response.json()));

      expect(bodies.filter((body) => body.claimed === true)).toHaveLength(1);
    });
  });
});

describe("given a caller that cannot manage the cache", () => {
  /** @scenario "A caller without the manage grain is refused" */
  it("refuses both reads and writes with HTTP 403", async () => {
    const api = await buildApi("no-grain");

    expect((await api.get("ACME_SESSION")).status).toBe(403);
    expect((await api.put("ACME_SESSION", { value: "session-1" })).status).toBe(403);
    expect(api.askedPermissions).toEqual(["agentCache:manage", "agentCache:manage"]);
  });

  /** @scenario "A request without an API key is refused" */
  it("refuses a request that carries no API key", async () => {
    const api = await buildApi("unauthenticated");

    expect((await api.get("ACME_SESSION")).status).toBe(401);
  });
});

describe("given a legacy project key", () => {
  /** @scenario "A legacy project key reaches the agent cache" */
  it("stores an entry and reads it back", async () => {
    const api = await buildApi();

    await api.put("ACME_SESSION", { value: "session-1" });
    const response = await api.get("ACME_SESSION");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ value: "session-1" });
  });
});

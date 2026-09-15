/** Exercises the declaration on its in-memory runtime without external members. */
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { GatewayAgentCacheService } from "../../services/gateway-agent-cache.service.ts";
import { MemoryGatewayAgentCacheEntryStore } from "../../stores/gateway-agent-cache/gateway-agent-cache.store.ts";
import { agentCacheRest } from "../agent-cache.rest.ts";

const PROJECT_ID = "project-1";
const encryption = {
  encrypt: (value: string) => `sealed:${value}`,
  decrypt: (value: string) => value.replace(/^sealed:/, ""),
};

const renderError: RestErrorHandler = (error, context) => {
  if (error instanceof Error && error.name === "RequestValidationError") {
    return context.json({ error: { code: "validation_error" } }, 422);
  }

  if (HandledError.isHandled(error)) {
    const status = error.httpStatus === 404 ? 404 : 500;
    return context.json({ error: { code: error.code, message: error.message } }, status);
  }

  return context.json({ error: { code: "internal_server_error" } }, 500);
};

function mountedAgentCache() {
  const service = GatewayAgentCacheService.create({
    store: MemoryGatewayAgentCacheEntryStore.create(),
    encryption,
  });
  const app = createApiFixture<GatewayApi>({
    getAgentCacheEntry: (input) => service.get(input),
    putAgentCacheEntry: (input) => service.put(input),
    claimAgentCacheEntry: (input) => service.claim(input),
    deleteAgentCacheEntry: (input) => service.delete(input),
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "api-key-1" },
        scope: { tier: "project", id: PROJECT_ID },
      }),
    },
  });

  return runtime.mount(agentCacheRest.router(), { app: () => app, onError: renderError });
}

describe("given the mounted agent-cache REST family", () => {
  describe("when a caller uses the published routes", () => {
    /** @scenario "A stored entry is read back by its name" */
    /** @scenario "Removing an entry the project does not hold succeeds" */
    it("stores, reads and removes one entry", async () => {
      const hono = mountedAgentCache();
      const write = await hono.request("/api/agent-cache/SESSION", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "state" }),
      });
      const read = await hono.request("/api/agent-cache/SESSION");
      const remove = await hono.request("/api/agent-cache/MISSING", { method: "DELETE" });

      expect(write.status).toBe(200);
      expect(await read.json()).toEqual({ name: "SESSION", value: "state" });
      expect(remove.status).toBe(200);
    });

    /** @scenario "A name the project does not hold is refused as not found" */
    it("answers an absent name with the cache miss code", async () => {
      const response = await mountedAgentCache().request("/api/agent-cache/MISSING");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "cache_entry_not_found" },
      });
    });

    /** @scenario "A value past the size limit is refused" */
    /** @scenario "A name outside the accepted shape is refused" */
    /** @scenario "A lifetime outside the accepted range is refused" */
    it("keeps validation refusals at HTTP 422", async () => {
      const hono = mountedAgentCache();
      const badName = await hono.request("/api/agent-cache/lowercase");
      const badLifetime = await hono.request("/api/agent-cache/SESSION", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "state", ttl_seconds: 1 }),
      });

      expect(badName.status).toBe(422);
      expect(badLifetime.status).toBe(422);
    });
  });
});

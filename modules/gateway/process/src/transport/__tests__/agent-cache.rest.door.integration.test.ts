/**
 * The agent-cache family behind the framework door, with the production error mapping: who may
 * reach an entry is the door's answer to the permission each route declares.
 * @vitest-environment node
 * @see specs/agent-cache/agent-cache.feature
 */
import { ProjectMissingCredentialsError } from "@langwatch/api";
import {
  canonicalErrorResponse,
  createRestRuntime,
  type RestPermissionReach,
} from "@langwatch/api/rest";
import { PermissionDeniedError } from "@langwatch/authorization";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryGatewayAgentCacheEntryRepository } from "../../repositories/memory/memory.gateway-agent-cache.repository.ts";
import { GatewayAgentCacheService } from "../../services/gateway-agent-cache.service.ts";
import { agentCacheRest } from "../agent-cache.rest.ts";

const PROJECT_ID = "project-1";

type DoorInput = { request: Request; permission: string; reach?: RestPermissionReach["at"] };

const wireBody = z.object({
  type: z.string().optional(),
  code: z.string().optional(),
  value: z.string().optional(),
});

/** A door that reads the credential, then answers the permission the route declared. */
function mount({ grants }: { grants: readonly string[] }) {
  const service = GatewayAgentCacheService.create({
    store: MemoryGatewayAgentCacheEntryRepository.create(),
  });
  const reads = vi.fn(service.get.bind(service));
  const writes = vi.fn(service.put.bind(service));
  const app = createApiFixture<GatewayApi>({
    getAgentCacheEntry: reads,
    putAgentCacheEntry: writes,
    claimAgentCacheEntry: (input) => service.claim(input),
    deleteAgentCacheEntry: (input) => service.delete(input),
  });
  const identify = ({ request }: { request: Request }) => {
    if (!request.headers.get("Authorization")) throw new ProjectMissingCredentialsError();
    return {
      actor: { type: "api_key" as const, id: "key-1" },
      scope: { tier: "project" as const, id: PROJECT_ID },
    };
  };
  const authenticate = ({ request, permission }: DoorInput) => {
    const caller = identify({ request });
    if (!grants.includes(permission)) {
      throw new PermissionDeniedError({
        permission,
        scope: { type: "project", id: PROJECT_ID },
        denialReason: "no-binding",
      });
    }
    return caller;
  };
  const runtime = createRestRuntime({
    identity: { authenticate, identify },
  });
  const hono = runtime.mount(agentCacheRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });
  const call = async (
    method: string,
    path: string,
    init: { body?: unknown; anonymous?: boolean } = {},
  ) => {
    const response = await hono.request(path, {
      method,
      headers: {
        ...(init.anonymous ? {} : { Authorization: "Bearer sk-lw-test" }),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { status: response.status, body: wireBody.parse(await response.json()) };
  };
  return { call, reads, writes };
}

describe("the agent-cache family's door", () => {
  describe("given a caller that holds neither agentCache grain", () => {
    /** @scenario A caller without the manage grain is refused */
    it("refuses a read and a write as forbidden, touching no entry", async () => {
      const { call, reads, writes } = mount({ grants: [] });

      const read = await call("GET", "/api/agent-cache/ACME_SESSION");
      const write = await call("PUT", "/api/agent-cache/ACME_SESSION", { body: { value: "v" } });

      expect([read.status, read.body.code]).toEqual([403, "permission_denied"]);
      expect([write.status, write.body.code]).toEqual([403, "permission_denied"]);
      expect(reads).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
    });
  });

  describe("given a request that carries no API key", () => {
    /** @scenario A request without an API key is refused */
    it("answers 401 unauthenticated and reads nothing", async () => {
      const { call, reads } = mount({ grants: ["agentCache:manage"] });

      const answer = await call("GET", "/api/agent-cache/ACME_SESSION", { anonymous: true });

      expect(answer.status).toBe(401);
      expect(answer.body.type).toBe("unauthenticated");
      expect(reads).not.toHaveBeenCalled();
    });
  });

  describe("given a caller that holds the manage grain", () => {
    it("stores an entry and reads it back", async () => {
      const { call } = mount({ grants: ["agentCache:manage"] });

      const write = await call("PUT", "/api/agent-cache/ACME_SESSION", { body: { value: "v" } });
      const read = await call("GET", "/api/agent-cache/ACME_SESSION");

      expect(write.status).toBe(200);
      expect([read.status, read.body.value]).toEqual([200, "v"]);
    });
  });
});

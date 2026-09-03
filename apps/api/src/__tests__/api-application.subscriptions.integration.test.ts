/**
 * The subscription lane, mounted on the process rather than merely built.
 *
 * The property under test is the one the plan's API-side mount is FOR: a path
 * on the subscription lane resolves against the SAME tRPC root the
 * `/api/trpc` endpoint serves, through the same request context. One root, two
 * transports — so a procedure cannot be callable and un-watchable, or watchable
 * on a router nobody else serves.
 *
 * `secrets.list` stands in for a subscription here on purpose: this process's
 * root carries no subscription procedure yet, and asserting the wiring with a
 * procedure that exists is honest, where asserting it with one that does not
 * would only prove the 404 path.
 */
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { SecretService, type Secret } from "@langwatch/secret-contract";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication, MissingAgentService } from "../api.application";
import { ApiRestSecurity } from "../api-rest.security";
import { ApiRestObservabilityComposition } from "../app/api-rest-observability.composition";
import { createSseSubscriptionApp } from "../app-trpc/app-trpc.sse";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

class TestSecretService extends SecretService {
  readonly list = vi.fn(async ({ projectId }: { projectId: string }) => [{ ...secret, projectId }]);
  readonly getValues = vi.fn(async () => ({}));
  readonly get = vi.fn(async () => secret);
  readonly create = vi.fn(async () => secret);
  readonly update = vi.fn(async () => secret);
  readonly delete = vi.fn(async () => undefined);
}

/** A REST security whose credential services are never reached; see the lane's own suite. */
function subscriptionSecurity() {
  const unreachable = <T extends object>(prototype: T): T =>
    new Proxy(prototype, {
      get: (target, property, receiver) =>
        property in target
          ? () => {
              throw new Error(`${String(property)} was reached on the subscription lane`);
            }
          : Reflect.get(target, property, receiver),
    });

  return ApiRestSecurity.create({
    apiKeys: unreachable(ApiKeyService.prototype),
    authz: unreachable(AuthzService.prototype),
    organizations: unreachable(OrganizationService.prototype),
    observability: ApiRestObservabilityComposition.create(),
  });
}

describe("ApiApplication's subscription lane", () => {
  describe("given a process that composed one", () => {
    it("resolves a path against the same root and context the tRPC endpoint serves", async () => {
      const secrets = new TestSecretService();
      const application = ApiApplication.create({
        agents: new MissingAgentService(),
        secrets,
        http: {
          createContext: async () => ({
            actor: () => ({ id: "user-1" }),
            authorize: async () => undefined,
          }),
          subscriptions: (ports) =>
            createSseSubscriptionApp({ security: subscriptionSecurity(), ports }).hono,
        },
      });
      if (!application.hono) throw new Error("HTTP composition was not created.");

      const input = encodeURIComponent(superjson.stringify({ projectId: "project-1" }));
      const response = await application.hono.request(`/api/sse/secrets.list?input=${input}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
      const frames = (await response.text())
        .split("\n\n")
        .map((block) =>
          block
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice("data: ".length))
            .join("\n"),
        )
        .filter((payload) => payload.length > 0)
        .map((payload) => superjson.parse(payload));

      expect(frames[0]).toEqual({ type: "connected" });
      expect(frames[1]).toMatchObject([{ projectId: "project-1", name: "MY_SECRET" }]);
      expect(frames[2]).toEqual({ type: "complete" });
      // The context, not just the router: the procedure ran as this request's
      // actor, through the same `createContext` the HTTP endpoint uses.
      expect(secrets.list).toHaveBeenCalledExactlyOnceWith({ projectId: "project-1" });
    });
  });

  describe("given a process that composed none", () => {
    it("serves no /api/sse route at all", async () => {
      const application = ApiApplication.create({
        agents: new MissingAgentService(),
        secrets: new TestSecretService(),
        http: {
          createContext: async () => ({
            actor: () => ({ id: "user-1" }),
            authorize: async () => undefined,
          }),
        },
      });
      if (!application.hono) throw new Error("HTTP composition was not created.");

      const response = await application.hono.request("/api/sse/secrets.list");

      expect(response.status).toBe(404);
    });
  });
});

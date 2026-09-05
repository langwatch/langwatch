/**
 * The subscription lane, mounted on the process rather than merely built. Two properties,
 * and the mount is where both are decidable.
 */
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { SecretService, type Secret } from "@langwatch/secret-contract";
import type { TRPCCreateRouterOptions } from "@trpc/server";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  ApiTrpcFeaturesPort,
  MissingAgentService,
  NoApiTrpcFeatures,
  type ApiTrpcFeatureMount,
} from "../api.application";
import { ApiRestSecurity } from "../api-rest.security";
import { ApiRestObservabilityComposition } from "../app/api-rest-observability.composition";
import { createSseSubscriptionApp } from "../app-trpc/app-trpc.sse";
import { sameOriginSseInit } from "../app-trpc/__tests__/support/sse-browser-request";

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

/**
 * One real subscription on this process's root. The application's own two namespaces
 * carry queries and mutations only, so without this the positive case could only be
 * asserted against a procedure the lane is now right to refuse.
 */
class LiveUpdateFeatures extends ApiTrpcFeaturesPort<TRPCCreateRouterOptions> {
  private readonly none = new NoApiTrpcFeatures();

  readonly authorization = this.none.authorization;
  readonly denials = this.none.denials;
  readonly causes = this.none.causes;
  readonly errorReporting = this.none.errorReporting;
  readonly application = this.none.application;

  build({ root, publicProcedure }: ApiTrpcFeatureMount): TRPCCreateRouterOptions {
    return {
      live: root.router({
        watch: publicProcedure.subscription(async function* () {
          yield { tick: 1 };
        }),
      }),
    };
  }
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

/** The process, composed with its subscription lane mounted. */
function processWithLane(secrets: SecretService) {
  const application = ApiApplication.create({
    features: new LiveUpdateFeatures(),
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
  const hono = application.hono;
  return {
    // Same-origin, the way a browser's own `EventSource` arrives.
    request: (path: string, headers: Record<string, string> = {}) =>
      hono.request(path, sameOriginSseInit({ headers })),
  };
}

/** Every `data:` frame a response body carried, decoded the way the client does. */
async function framesOf(response: Response): Promise<unknown[]> {
  return (await response.text())
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
}

describe("ApiApplication's subscription lane", () => {
  describe("given a subscription on the process's own root", () => {
    /** @scenario A subscription path still streams */
    it("resolves it against the same root and context the tRPC endpoint serves", async () => {
      const lane = processWithLane(new TestSecretService());

      const response = await lane.request("/api/sse/live.watch");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
      await expect(framesOf(response)).resolves.toEqual([
        { type: "connected" },
        { tick: 1 },
        { type: "complete" },
      ]);
    });
  });

  describe("given a mutation on that same root", () => {
    /** @scenario A mutation reached over the subscription lane never runs */
    it("refuses it and leaves the service behind it untouched", async () => {
      const secrets = new TestSecretService();
      const lane = processWithLane(secrets);

      const input = encodeURIComponent(
        superjson.stringify({ projectId: "project-1", name: "STOLEN", value: "x" }),
      );
      const response = await lane.request(`/api/sse/secrets.create?input=${input}`);

      expect(response.status).toBe(405);
      await expect(response.json()).resolves.toMatchObject({
        error: "live_stream_unsupported_procedure",
      });
      expect(secrets.create).not.toHaveBeenCalled();
    });

    /** @scenario A query reached over the subscription lane never runs */
    it("refuses a query on the same grounds", async () => {
      const secrets = new TestSecretService();
      const lane = processWithLane(secrets);

      const input = encodeURIComponent(superjson.stringify({ projectId: "project-1" }));
      const response = await lane.request(`/api/sse/secrets.list?input=${input}`);

      expect(response.status).toBe(405);
      expect(secrets.list).not.toHaveBeenCalled();
    });
  });

  describe("given a path this root carries no procedure at", () => {
    /** @scenario An unknown subscription path is refused as not found */
    it("answers not found without building a caller", async () => {
      const lane = processWithLane(new TestSecretService());

      const response = await lane.request("/api/sse/secrets.somethingElse");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "live_stream_not_found" });
    });
  });

  describe("given a request from another site", () => {
    /** @scenario A cross-site request cannot open the subscription lane */
    it("refuses it even though the path names a real subscription", async () => {
      const lane = processWithLane(new TestSecretService());

      const response = await lane.request("/api/sse/live.watch", {
        "sec-fetch-site": "cross-site",
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "live_stream_cross_site_blocked",
      });
    });
  });

  describe("given a process that composed none", () => {
    it("serves no /api/sse route at all", async () => {
      const application = ApiApplication.create({
        features: new NoApiTrpcFeatures(),
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

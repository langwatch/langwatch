import type { AgentApi } from "@langwatch/agent-contract";
import type { Secret, SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../api.application.ts";
import { ApiHttpListener } from "../api-http.listener.ts";
import { ApiTrpcFeaturesComposition } from "../app/api-trpc-features.composition.ts";
import {
  stub,
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../app/__tests__/api-trpc-record.test-doubles.ts";
import type { ApiTrpcInfrastructure } from "../platform/infrastructure/api-trpc.infrastructure.ts";
import { createSecretTrpcRouter } from "../features/secret/secret-trpc.mount.ts";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

describe("ApiApplication HTTP transport", () => {
  it("serves a mixed tRPC batch through the standalone listener and one composed service", async () => {
    const list = vi.fn(async ({ projectId }: { projectId: string }) => [{ ...secret, projectId }]);
    const secrets = createApiFixture<SecretApi>({ list }, "secrets");
    const authz = createApiFixture<ApiTrpcInfrastructure["authz"]>({
      getDecision: async () => ({ permitted: true, organizationRole: null }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
      checkScopeLineage: async () => ({ kind: "consistent" as const }),
      hasPermission: async () => true,
    });
    const features = ApiTrpcFeaturesComposition.tryCompose({
      composed: {
        ...stubComposedFeatures(),
        secret: {
          app: secrets,
          rest: [],
          routers: (mount) => ({ secrets: createSecretTrpcRouter(mount.runtime) }),
        },
      },
      infrastructure: {
        ...stubInfrastructureEntitlements(),
        prisma: stub<ApiTrpcInfrastructure["prisma"]>("infrastructure.prisma"),
        authz,
        audit: undefined,
      },
      collaborators: stubCollaborators({ secrets }),
    });
    if (!features) throw new Error("the record refused to compose against its collaborators");

    const application = ApiApplication.create({
      features,
      agents: createApiFixture<AgentApi>(),
      http: {
        createContext: async () => ({
          actor: () => ({ id: "user-1" }),
          tryActor: () => ({ id: "user-1" }),
          authorize: async () => undefined,
          session: { user: { id: "user-1", name: "Alex", email: "alex@acme.test", role: "ADMIN" } },
        }),
      },
    });
    if (!application.hono) throw new Error("HTTP composition was not created.");
    const listener = ApiHttpListener.create({
      application: application.hono,
      host: "127.0.0.1",
      port: 0,
    });
    const address = await listener.start();

    try {
      const input = encodeURIComponent(
        JSON.stringify({
          0: { projectId: "project-1" },
          1: { projectId: "project-2" },
        }),
      );
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/trpc/secrets.list,secrets.list?batch=1&input=${input}`,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
        { result: { data: [{ projectId: "project-1", name: "MY_SECRET" }] } },
        { result: { data: [{ projectId: "project-2", name: "MY_SECRET" }] } },
      ]);
      expect(list).toHaveBeenNthCalledWith(1, { projectId: "project-1" });
      expect(list).toHaveBeenNthCalledWith(2, { projectId: "project-2" });
    } finally {
      await listener.close();
    }
  });
});

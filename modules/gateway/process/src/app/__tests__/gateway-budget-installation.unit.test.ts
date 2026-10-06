import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { SecretApi } from "@langwatch/secret-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { gatewayProcessModule } from "../../gateway.module.ts";

/** No secret is set: the gateway's three credentials are optional and all-or-none. */
const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());

/** The memory stores plus the eventing the gateway's pipelines read. */
function memberSource() {
  const stores = memoryStores();
  const eventing = new EventSourcing({
    enabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
  });

  return {
    tier: stores.tier,
    order: [...stores.order, "eventing"],
    read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
    close: async () => void 0,
  };
}

function recordingHost(mounted: unknown[]) {
  return { mount: (_declaration: object, app: () => unknown) => void mounted.push(app()) };
}

async function bootGateway() {
  const rest: unknown[] = [];
  const trpc: unknown[] = [];
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: [gatewayProcessModule],
    config: { gateway: {} },
    members: memberSource(),
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    peers: [
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({
        token: ProjectApi,
        instance: createApiFixture<ProjectApi>({
          listIdsByOrganization: async () => [],
          listTraceDestinations: async () => [],
        }),
      }),
      testPeer({ token: EvaluatorApi, instance: createApiFixture<EvaluatorApi>() }),
      testPeer({ token: EvaluationApi, instance: createApiFixture<EvaluationApi>() }),
      testPeer({ token: MonitorApi, instance: createApiFixture<MonitorApi>() }),
      testPeer({ token: OrganizationApi, instance: createApiFixture<OrganizationApi>() }),
      testPeer({ token: FeatureFlagApi, instance: createApiFixture<FeatureFlagApi>() }),
      testPeer({ token: ModelProviderApi, instance: createApiFixture<ModelProviderApi>() }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>() }),
      testPeer({ token: SecretApi, instance: createApiFixture<SecretApi>() }),
      testPeer({ token: ApiKeyApi, instance: createApiFixture<ApiKeyApi>() }),
    ],
    surface: () => ({
      hosts: { rest: recordingHost(rest), trpc: recordingHost(trpc) },
      serve: () => undefined,
    }),
  });

  return { runtime, rest, trpc };
}

describe("gateway budget installation", () => {
  describe("when the gateway module boots in the api role", () => {
    /** @scenario "The process owns one budget decision service" */
    it("hands every REST and tRPC door the one gateway app the process booted", async () => {
      const { runtime, rest, trpc } = await bootGateway();

      try {
        const app = runtime.module(gatewayProcessModule).provided;

        expect(rest.length).toBeGreaterThan(1);
        expect(trpc.length).toBeGreaterThan(1);
        for (const mounted of [...rest, ...trpc]) expect(mounted === app).toBe(true);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "The process owns one budget decision service" */
    it("lets a budget created through one door be read through another from the one repository", async () => {
      const { runtime, rest, trpc } = await bootGateway();

      try {
        const writer = trpc[0] as GatewayApi;
        const reader = rest[0] as GatewayApi;

        await writer.createBudget({
          organizationId: "organization-1",
          scope: { kind: "ORGANIZATION", organizationId: "organization-1" },
          name: "Shared budget",
          window: "MONTH",
          limitUsd: 10,
          actorUserId: "user-1",
        });
        const listed = await reader.listBudgetsWithHealth("organization-1");

        expect(listed.budgets.map((budget) => budget.name)).toEqual(["Shared budget"]);
      } finally {
        await runtime.stop();
      }
    });
  });
});

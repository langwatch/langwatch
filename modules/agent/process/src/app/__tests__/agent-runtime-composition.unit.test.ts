import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { agentProcessModule } from "../../agent.module.ts";

type Role = "api" | "worker";

function recordingHost(mounted: unknown[]) {
  return { mount: (_declaration: object, app: () => unknown) => void mounted.push(app()) };
}

async function bootAgent(role: Role) {
  const rest: unknown[] = [];
  const trpc: unknown[] = [];
  const websocket: unknown[] = [];
  const runtime = await bootInstalledProcess({
    role,
    modules: [agentProcessModule],
    config: { agent: { replicaCount: 1, relayMaxPayloadMb: undefined, publicBaseUrl: undefined } },
    stores: memoryStores(),
    peers: [
      testPeer({ token: ApiKeyApi, instance: createApiFixture<ApiKeyApi>() }),
      testPeer({ token: AuditLogApi, instance: createApiFixture<AuditLogApi>() }),
      testPeer({ token: FeatureFlagApi, instance: createApiFixture<FeatureFlagApi>() }),
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>() }),
      testPeer({ token: SecretApi, instance: createApiFixture<SecretApi>() }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
      testPeer({ token: WorkflowApi, instance: createApiFixture<WorkflowApi>() }),
    ],
    surface: () => ({
      hosts: {
        rest: recordingHost(rest),
        trpc: recordingHost(trpc),
        websocket: recordingHost(websocket),
      },
      serve: () => undefined,
    }),
  });

  return { runtime, rest, trpc, websocket };
}

describe("agent runtime composition", () => {
  describe("when the api process installs Agent", () => {
    /** @scenario "Each runtime composes one Agent graph" */
    it("gives its RPC, REST and connection protocols the one agent app", async () => {
      const { runtime, rest, trpc, websocket } = await bootAgent("api");

      try {
        const app = runtime.module(agentProcessModule).provided;

        expect(rest.length).toBeGreaterThan(0);
        expect(trpc.length).toBeGreaterThan(0);
        expect(websocket.length).toBeGreaterThan(0);
        for (const mounted of [...rest, ...trpc, ...websocket]) expect(mounted === app).toBe(true);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the worker process installs Agent", () => {
    /** @scenario "Each runtime composes one Agent graph" */
    it("composes its app and mounts no inbound transport", async () => {
      const { runtime, rest, trpc, websocket } = await bootAgent("worker");

      try {
        expect(runtime.module(agentProcessModule).provided).toBeDefined();
        expect([...rest, ...trpc, ...websocket]).toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });
});

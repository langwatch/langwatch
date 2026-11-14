/**
 * The installed module over memory twins in both roles: one app behind the REST and tRPC
 * transports, the door and the gate bound as middleware, the expiry sweep on the worker.
 */
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { NotificationService } from "@langwatch/notification-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { StaffAccessApi } from "@langwatch/staff-access-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { staffAccessProcessModule } from "../../staff-access.module.ts";

function recordingHost(mounted: unknown[]) {
  return { mount: (_declaration: object, app: () => unknown) => void mounted.push(app()) };
}

async function boot(role: "api" | "worker") {
  const rest: unknown[] = [];
  const trpc: unknown[] = [];
  const runtime = await bootInstalledProcess({
    role,
    modules: [staffAccessProcessModule],
    config: { "staff-access": { publicBaseUrl: "https://app.langwatch.test" } },
    stores: memoryStores(),
    peers: [
      testPeer({
        token: OpsApi,
        instance: createApiFixture<OpsApi>({ offersCloudOps: () => false }),
      }),
      testPeer({
        token: FeatureFlagApi,
        instance: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      }),
      testPeer({ token: AuthApi, instance: createApiFixture<AuthApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
      testPeer({ token: OrganizationApi, instance: createApiFixture<OrganizationApi>() }),
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>() }),
      testPeer({ token: ApiKeyApi, instance: createApiFixture<ApiKeyApi>() }),
      testPeer({ token: AuditLogApi, instance: createApiFixture<AuditLogApi>() }),
      testPeer({ token: NotificationService, instance: createApiFixture<NotificationService>() }),
      testPeer({ token: CodingAgentApi, instance: createApiFixture<CodingAgentApi>() }),
      testPeer({ token: GatewayApi, instance: createApiFixture<GatewayApi>() }),
      testPeer({ token: TraceApi, instance: createApiFixture<TraceApi>() }),
    ],
    surface: () => ({
      hosts: { rest: recordingHost(rest), trpc: recordingHost(trpc) },
      serve: () => undefined,
    }),
  });
  return { runtime, rest, trpc };
}

describe("given a process that installed staff access", () => {
  describe("when the api process boots", () => {
    it("mounts its REST and tRPC transports on the one app and stays hidden while off", async () => {
      const { runtime, rest, trpc } = await boot("api");

      try {
        const app = runtime.service(StaffAccessApi);
        expect(runtime.module(staffAccessProcessModule).provided).toBe(app);
        expect(rest.length).toBeGreaterThan(0);
        expect(trpc.length).toBeGreaterThan(0);
        for (const mounted of [...rest, ...trpc]) expect(mounted).toBe(app);
        await expect(app.overview({ actor: { type: "user", id: "user_1" } })).rejects.toMatchObject(
          { code: "not_found" },
        );
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the worker process boots", () => {
    it("composes the app and sweeps with nothing to audit", async () => {
      const { runtime, rest, trpc } = await boot("worker");

      try {
        expect(rest).toEqual([]);
        expect(trpc).toEqual([]);
        await expect(
          runtime.service(StaffAccessApi).sweepExpiredSessions({ at: Date.now() }),
        ).resolves.toEqual({ audited: 0 });
      } finally {
        await runtime.stop();
      }
    });
  });
});

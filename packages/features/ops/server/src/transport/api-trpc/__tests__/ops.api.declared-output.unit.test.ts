/**
 * @vitest-environment node
 *
 * Every ops procedure declares the shape it answers, and this suite is what
 * makes that declaration mean something at runtime: the router is built with
 * `validateOutput`, so an answer its own schema refuses throws instead of
 * reaching a browser that would read the missing field as `undefined`.
 *
 * The shapes the SERVICES own are already pinned by the compiler — every one
 * of them is `z.infer` of the schema declared beside it, so a drift is a type
 * error. What has no compile-time proof is the shapes this TRANSPORT invents:
 * the scope probe, the process's two readings, and the acknowledgements. Those
 * are what is exercised here.
 */
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { OpsEventingIntrospectionPort } from "../../../ports/eventing-introspection.port.ts";
import { OpsApp, type OpsCapability } from "../../../app/ops.app.ts";
import { OpsTrpcApi, type OpsTrpcContext, type OpsTrpcPorts } from "../ops.api.ts";

const trpc = initTRPC.context<OpsTrpcContext>().create();

function buildPorts(): OpsTrpcPorts {
  return {
    listPipelineRegistrations: () => ({
      projections: [
        {
          projectionName: "trace-summary",
          pipelineName: "traces",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "traces:trace-summary",
          kind: "fold",
        },
      ],
      eventSubscribers: [
        {
          subscriberName: "trace-indexer",
          pipelineName: "traces",
          aggregateType: "trace",
          eventTypes: ["trace.ingested"],
        },
      ],
    }),
    getEventLogSearchWindow: () => ({
      searchLookbackDays: 365,
      hotTierDays: null,
      hotTierEnvVar: null,
    }),
    tryGetGrafanaLinkConfig: () => null,
    systemMigrations: {
      getOverview: vi.fn(),
      getEnrollments: vi.fn(),
      searchOrganizations: vi.fn(),
      requiresOperatorConfirmation: () => false,
      enroll: vi.fn().mockResolvedValue(undefined),
      enrollCohort: vi.fn(),
      withdraw: vi.fn().mockResolvedValue(undefined),
      runForOrganization: vi.fn(),
      startPass: vi.fn(),
      assertLegacyWritersDrained: vi.fn(),
      rollBack: vi.fn(),
    },
  } satisfies OpsTrpcPorts;
}

function buildCaller(capability: Partial<OpsCapability> = {}) {
  const router = OpsTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => procedure,
      probePolicy: (procedure) => procedure,
      validateOutput: true,
    },
    buildPorts(),
  );

  const app = OpsApp.create({
    ops: capability as OpsCapability,
    featureFlags: {} as FeatureFlagService,
    projects: { searchByQuery: async () => [] },
    eventingIntrospection: new (class extends OpsEventingIntrospectionPort {
      projections() {
        return [];
      }
      killSwitches() {
        return [];
      }
      processManagers() {
        return [];
      }
      dejaViewProjections() {
        return [];
      }
    })(),
  });

  return router.createCaller({
    app: { ops: app },
    actor: () => ({ id: "user_alex" }),
    opsScope: { kind: "platform" },
    session: { user: { id: "user_alex", email: "staff@langwatch.ai" } },
  });
}

describe("the ops surface's declared answers", () => {
  describe("when a read answers", () => {
    it("passes the scope probe's declared shape", async () => {
      await expect(buildCaller().getScope()).resolves.toEqual({
        scope: { kind: "platform" },
      });
    });

    it("passes the badge reading's, whose computedAt is null with no collector", async () => {
      await expect(buildCaller().getBadgeCounts()).resolves.toEqual({
        blockedCount: 0,
        dlqCount: 0,
        computedAt: null,
      });
    });

    it("passes the pipeline registry's, event subscribers included", async () => {
      const registrations = await buildCaller().listProjections();

      expect(registrations.projections[0]?.kind).toBe("fold");
      expect(registrations.eventSubscribers[0]?.eventTypes).toEqual(["trace.ingested"]);
    });

    it("passes the event-log window's and the absent Grafana configuration's", async () => {
      const caller = buildCaller();

      await expect(caller.getEventLogSearchWindow()).resolves.toEqual({
        searchLookbackDays: 365,
        hotTierDays: null,
        hotTierEnvVar: null,
      });
      await expect(caller.getGrafanaLinkConfig()).resolves.toBeNull();
    });

    it("passes the anomaly listing's wrapper", async () => {
      const caller = buildCaller({ listAnomalies: async () => [] });

      await expect(caller.listAnomalies()).resolves.toEqual({ anomalies: [] });
    });
  });

  describe("when a write acknowledges", () => {
    it("passes each acknowledgement's declared shape", async () => {
      const caller = buildCaller({
        unblockQueueGroup: async () => ({ wasBlocked: true }),
        dismissAnomaly: async () => true,
      });

      await expect(caller.unblockGroup({ queueName: "traces", groupId: "g-1" })).resolves.toEqual({
        wasBlocked: true,
      });
      await expect(
        caller.dismissAnomaly({ tenantId: "project_a", kind: "rate_breaker" }),
      ).resolves.toEqual({ dismissed: true });
      await expect(caller.runSystemMigrationPass()).resolves.toEqual({ started: true });
      await expect(
        caller.enrollMigrationTenant({
          organizationId: "org_acme",
          migrationName: "authz-team-user-backfill",
        }),
      ).resolves.toEqual({ enrolled: true });
      await expect(
        caller.withdrawMigrationTenant({
          organizationId: "org_acme",
          migrationName: "authz-team-user-backfill",
        }),
      ).resolves.toEqual({ withdrawn: true });
    });
  });

  describe("when an answer drifts from what the procedure declared", () => {
    /**
     * The guard has to be able to fail, or the suite above proves nothing. A
     * queue service answering without `wasBlocked` is the real drift this
     * catches: the ops page renders it, and `undefined` reads as "not blocked".
     */
    it("refuses it, naming the procedure and the field", async () => {
      const caller = buildCaller({
        unblockQueueGroup: async () => ({}) as { wasBlocked: boolean },
      });

      await expect(caller.unblockGroup({ queueName: "traces", groupId: "g-1" })).rejects.toThrow(
        /unblockGroup[\s\S]*wasBlocked/,
      );
    });
  });
});

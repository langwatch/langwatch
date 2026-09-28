import { createApiFixture } from "@langwatch/api-fixture";
import type { TrpcContract } from "@langwatch/api/contract";
/**
 * @vitest-environment node
 * What the ops surface answers, over the real runtime and a real `OpsApp`.
 * Every operator page reads its fields off these shapes, so a changed one
 * is a blank card rather than an error.
 */
import { bindTrpcFact, createTrpcRuntime, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import type { OpsApi, OpsOperator } from "@langwatch/ops-contract";
import type { OpsCapability } from "@langwatch/ops-process";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "../../app/__tests__/ops.fixture.ts";
import type { OpsReplayRunner } from "../../app/ops.app.ts";
import { opsDashboardTrpcTransport } from "../ops-dashboard.trpc.ts";
import { opsEventLogTrpcTransport } from "../ops-event-log.trpc.ts";
import { opsOperatorFact } from "../ops-operator.trpc.ts";
import { opsPlatformTrpcTransport } from "../ops-platform.trpc.ts";
import { opsQueueTrpcTransport } from "../ops-queue.trpc.ts";
import { opsTrpcTestMembers } from "./ops.trpc.harness.ts";

type OpsAnswersContext = { actor: { id: string }; operator: OpsOperator | null };

const OPERATOR: OpsOperator = { id: "user_alex", email: OPS_STAFF_ADDRESS };
const OUTSIDER: OpsOperator = { id: "user_sam", email: "sam@acme.com" };

function mount<Contract extends TrpcContract>(
  declaration: TrpcRouterDeclaration<OpsApi, Contract>,
  capability: Partial<OpsCapability> = {},
  members: NonNullable<Parameters<typeof createOpsTestApp>[0]>["members"] = {},
) {
  const { app } = createOpsTestApp({ capability, members });
  const trpc = initTRPC.context<OpsAnswersContext>().create();
  const router = createTrpcRuntime<OpsAnswersContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: opsTrpcTestMembers(),
  }).mount(declaration, () => app, {
    facts: [bindTrpcFact(opsOperatorFact, (ctx: OpsAnswersContext) => ctx.operator)],
  });

  return {
    operator: router.createCaller({ actor: { id: OPERATOR.id }, operator: OPERATOR }),
    outsider: router.createCaller({ actor: { id: OUTSIDER.id }, operator: OUTSIDER }),
  };
}

describe("the ops surface's declared answers", () => {
  describe("given an operator on the allow-list", () => {
    it("answers the scope probe with the platform reach", async () => {
      const { operator } = mount(opsDashboardTrpcTransport);

      await expect(operator.getScope()).resolves.toEqual({ scope: { kind: "platform" } });
    });

    it("answers the badge reading, whose computedAt is null with no collector", async () => {
      const { operator } = mount(opsDashboardTrpcTransport);

      await expect(operator.getBadgeCounts()).resolves.toEqual({
        blockedCount: 0,
        dlqCount: 0,
        computedAt: null,
      });
    });

    it("answers the pipeline registry, event subscribers included", async () => {
      const { operator } = mount(
        opsQueueTrpcTransport,
        {},
        {
          pipelines: {
            listRegistrations: () => ({
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
          },
        },
      );

      const registrations = await operator.listProjections();

      expect(registrations.projections[0]?.kind).toBe("fold");
      expect(registrations.eventSubscribers[0]?.eventTypes).toEqual(["trace.ingested"]);
    });

    it("answers the event-log window and the absent Grafana configuration", async () => {
      const eventLog = mount(opsEventLogTrpcTransport);
      const queues = mount(opsQueueTrpcTransport);

      await expect(eventLog.operator.getEventLogSearchWindow()).resolves.toEqual({
        searchLookbackDays: 365,
        hotTierDays: null,
        hotTierEnvVar: null,
      });
      await expect(queues.operator.getGrafanaLinkConfig()).resolves.toBeNull();
    });

    it("answers the anomaly listing inside its wrapper", async () => {
      const { operator } = mount(opsEventLogTrpcTransport, { listAnomalies: async () => [] });

      await expect(operator.listAnomalies()).resolves.toEqual({ anomalies: [] });
    });
  });

  describe("given a write that acknowledges", () => {
    it("answers each acknowledgement's declared shape", async () => {
      const queues = mount(opsQueueTrpcTransport, {
        unblockQueueGroup: async () => ({ wasBlocked: true }),
      });
      const eventLog = mount(opsEventLogTrpcTransport, { dismissAnomaly: async () => true });
      const platform = mount(opsPlatformTrpcTransport);

      await expect(
        queues.operator.unblockGroup({ queueName: "traces", groupId: "g-1" }),
      ).resolves.toEqual({ wasBlocked: true });
      await expect(
        eventLog.operator.dismissAnomaly({ tenantId: "project_a", kind: "rate_breaker" }),
      ).resolves.toEqual({ dismissed: true });
      await expect(platform.operator.runSystemMigrationPass()).resolves.toEqual({ started: true });
      await expect(
        platform.operator.enrollMigrationTenant({
          organizationId: "org_acme",
          migrationName: "authz-team-user-backfill",
        }),
      ).resolves.toEqual({ enrolled: true });
      await expect(
        platform.operator.withdrawMigrationTenant({
          organizationId: "org_acme",
          migrationName: "authz-team-user-backfill",
        }),
      ).resolves.toEqual({ withdrawn: true });
    });
  });

  describe("given a caller who is not on the allow-list", () => {
    it("refuses the read rather than answering an empty one", async () => {
      const { outsider } = mount(opsDashboardTrpcTransport);

      await expect(outsider.getBadgeCounts()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses the write", async () => {
      const { outsider } = mount(opsQueueTrpcTransport);

      await expect(
        outsider.unblockGroup({ queueName: "traces", groupId: "g-1" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** The probe answers rather than refuses, so the menu can poll it. */
    it("answers the probe with no reach at all", async () => {
      const { outsider } = mount(opsDashboardTrpcTransport);

      await expect(outsider.getScope()).resolves.toEqual({ scope: { kind: "none" } });
    });
  });

  describe("when an operator starts a replay from the console", () => {
    /** @scenario "Starting a replay from the console files it under the operator who asked" */
    it("hands the replay the operator's user id, so the start is not refused", async () => {
      const started: Parameters<OpsReplayRunner["startReplay"]>[0][] = [];
      const { operator } = mount(opsEventLogTrpcTransport, {
        replay: createApiFixture<OpsReplayRunner>({
          startReplay: async (input) => {
            started.push(input);
            return { runId: "replay_1" };
          },
        }),
      });

      await expect(
        operator.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-09-01T00:00:00.000Z",
          description: "rebuild after the fold fix",
        }),
      ).resolves.toEqual({ runId: "replay_1" });
      expect(started).toEqual([
        expect.objectContaining({ requestedByUserId: OPERATOR.id, tenantIds: [] }),
      ]);
    });

    /** @scenario "A replay start that names no operator is refused as needing a session" */
    it("refuses an in-process start that names no operator, before the replay is asked", async () => {
      const startReplay = vi.fn(async () => ({ runId: "never" }));
      const { app } = createOpsTestApp({
        capability: { replay: createApiFixture<OpsReplayRunner>({ startReplay }) },
      });

      await expect(
        app.startReplay({
          projectionNames: ["traceSummary"],
          since: "2026-09-01T00:00:00.000Z",
          tenantIds: [],
          description: "rebuild",
          userName: "unknown",
        }),
      ).rejects.toMatchObject({ code: "ops_operator_session_required" });
      expect(startReplay).not.toHaveBeenCalled();
    });
  });

  describe("when an answer drifts from what the procedure declared", () => {
    it("preserves the response while the runtime reports the mismatch", async () => {
      const { operator } = mount(opsQueueTrpcTransport, {
        unblockQueueGroup: async () => ({}) as { wasBlocked: boolean },
      });

      await expect(operator.unblockGroup({ queueName: "traces", groupId: "g-1" })).resolves.toEqual(
        {},
      );
    });
  });
});

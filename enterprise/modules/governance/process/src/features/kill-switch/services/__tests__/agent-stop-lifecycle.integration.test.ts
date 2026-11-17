/**
 * How a stop's lifecycle requests and plan changes settle: the 202 a restore or retry answers, a
 * target the plan drops, a stop left with nothing, and shared keys two restores let go at once.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryGovernanceRepositories } from "../../../../repositories/memory/memory.governance.repositories.ts";
import {
  presentPlatforms,
  seedRegistry,
} from "../../../../repositories/prisma/__tests__/prisma.kill-switch.fixtures.ts";
import { requestedStop, targetAppliedStop } from "../../rules/agent-stop.rules.ts";
import { AgentStopClaimService } from "../agent-stop-claim.service.ts";
import { AgentStopPlanService } from "../agent-stop-plan.service.ts";
import { AgentStopService } from "../agent-stop.service.ts";
import { KillSwitchAuditService } from "../kill-switch-audit.service.ts";
import { codeOf, type Harness, request, settled } from "./kill-switch-steps.fixtures.ts";
import {
  AGENT_ID,
  killSwitchHarness,
  MACHINE,
  ORG,
  OTHER_MACHINE,
  PERSON,
  VIRTUAL_KEY_ID,
} from "./kill-switch.fixtures.ts";

const KEY_TARGET = {
  id: "target-vk",
  label: "Virtual key vk-support-bot",
  target: { kind: "gateway_virtual_key" as const, virtualKeyId: VIRTUAL_KEY_ID },
};

/**
 * A stop service over memory whose sends reach no pipeline, so the projection never folds them:
 * the worst lag a request can meet. The stop is seeded quarantined, and its plan gained a key
 * since, so a retry has something to apply.
 */
async function laggingService() {
  const repositories = MemoryGovernanceRepositories.create();
  await seedRegistry({ memory: repositories, organizationId: ORG });
  await repositories.agentStopPlans.replaceTargets({
    organizationId: ORG,
    agentId: AGENT_ID,
    targets: [
      KEY_TARGET,
      {
        id: "target-vk-new",
        label: "Virtual key vk-new",
        target: { kind: "gateway_virtual_key", virtualKeyId: "vk-new" },
      },
    ],
  });
  const sent: string[] = [];
  let ids = 0;
  const service = AgentStopService.create({
    stops: repositories.agentStops,
    claims: AgentStopClaimService.create({
      claims: repositories.agentStopClaims,
      stops: repositories.agentStops,
    }),
    plans: AgentStopPlanService.create({
      plans: repositories.agentStopPlans,
      registry: repositories.agentRegistry,
      sources: repositories.ingestionSources,
      awsConnections: repositories.awsConnections,
      virtualKeys: createApiFixture<GatewayApi>(),
      ...presentPlatforms({ memory: repositories }),
    }),
    locks: repositories.killSwitchLock,
    registry: repositories.agentRegistry,
    audit: KillSwitchAuditService.create({
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
      outbox: () => undefined,
    }),
    send: async (name) => {
      sent.push(name);
    },
    newId: () => `id-${++ids}`,
  });
  const requested = requestedStop({
    data: {
      stopId: "stop-1",
      organizationId: ORG,
      agentId: AGENT_ID,
      agentName: "support-bot",
      severity: "high",
      approval: "immediate",
      trigger: "user",
      reason: "prompt injection in production",
      requestedByUserId: PERSON.userId,
      requestedByApiKeyId: null,
      targets: [KEY_TARGET],
    },
    at: 1_000,
  });
  const quarantined = targetAppliedStop({
    stop: requested,
    data: { stopId: "stop-1", organizationId: ORG, targetId: KEY_TARGET.id, errorCode: null },
    at: 2_000,
  });
  await repositories.agentStops.seed({ stop: quarantined, at: 2_000 });
  return { service, sent, repositories };
}

describe("AgentStopService lifecycle requests", () => {
  describe("when the worker has not folded a restore yet", () => {
    /** @scenario "A restore or retry answers what the stop accepted, however far the worker lags" */
    it("refuses the retry that follows it at once, as the stop itself would", async () => {
      const { service, sent } = await laggingService();

      const restoring = await service.restore({
        organizationId: ORG,
        stopId: "stop-1",
        caller: PERSON,
      });
      const refused = await codeOf(
        service.retryStop({ organizationId: ORG, stopId: "stop-1", caller: PERSON }),
      );

      expect(restoring).toMatchObject({ status: "restoring", lastRequestId: "id-1" });
      expect(refused).toBe("agent_stop_not_retryable");
      expect(sent).toEqual(["requestRestore"]);
    });

    /** @scenario "A restore or retry answers what the stop accepted, however far the worker lags" */
    it("accepts exactly one of a restore and a retry asked at the same moment", async () => {
      const { service, sent } = await laggingService();

      const answers = await Promise.allSettled([
        service.retryStop({ organizationId: ORG, stopId: "stop-1", caller: PERSON }),
        service.restore({ organizationId: ORG, stopId: "stop-1", caller: PERSON }),
      ]);

      expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });
  });

  describe("given a quarantined stop whose plan drops targets", () => {
    let harness: Harness;
    let view: AgentStopView;
    beforeEach(async () => {
      harness = await killSwitchHarness();
      await harness.setFullPlan();
      view = await request(harness);
      await settled(harness, view.id, "quarantined");
    });
    afterEach(() => harness.eventing.close());

    /** @scenario "A target the stop changed is reverted when the plan drops it" */
    it("enables the key again and keeps the agent quarantined on what is left", async () => {
      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.filter((target) => target.kind !== "gateway_virtual_key"),
      });
      await vi.waitFor(async () => expect((await harness.stopOf(view.id)).targets).toHaveLength(2));

      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect((await harness.stopOf(view.id)).status).toBe("quarantined");
      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      await settled(harness, view.id, "restored");
      expect(harness.virtualKeyCalls.map((call) => call.action)).toEqual(["disable", "enable"]);
    });

    /** @scenario "A stop whose plan lost every target closes as restored" */
    it("restores the stop once every target was dropped and reverted", async () => {
      await harness.stops.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: [] });
      const restored = await settled(harness, view.id, "restored");

      expect(restored.targets).toEqual([]);
      expect(restored.quarantinedAt).not.toBeNull();
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect(harness.bedrock.updates.at(-1)?.aliasInvocationState).toBe("ACCEPT_INVOCATIONS");
    });
  });

  describe("given an approved stop whose target left the plan without a drop", () => {
    /** @scenario "An apply for a target the plan no longer holds is recorded failed" */
    it("records the target failed with target_not_in_plan instead of leaving it pending", async () => {
      const harness = await killSwitchHarness();
      await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.filter((target) => target.kind === "gateway_virtual_key"),
      });
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");
      await harness.plans.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: [] });

      await harness.stops.approveStop({
        organizationId: ORG,
        stopId: view.id,
        caller: OTHER_MACHINE,
      });
      const failed = await settled(harness, view.id, "stop_failed");

      expect(failed.targets[0]).toMatchObject({ state: "failed", errorCode: "target_not_in_plan" });
      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.eventing.close();
    });
  });

  describe("given a shared key lock whose transaction is about to end", () => {
    /** @scenario "Key work never runs after its lock may have ended" */
    it("leaves the key alone and records the stop failed", async () => {
      const harness = await killSwitchHarness({ maxAttempts: 1 });
      await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.filter((target) => target.kind === "gateway_virtual_key"),
      });
      vi.spyOn(harness.repositories.killSwitchLock, "withLock").mockImplementation(({ run }) =>
        run({ signal: AbortSignal.abort() }),
      );

      const view = await request(harness);
      await settled(harness, view.id, "stop_failed");

      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.eventing.close();
    });
  });

  describe("given two quarantined stops sharing a key, both being restored", () => {
    /** @scenario "Two restores of stops sharing a virtual key enable it" */
    it("enables the key even while the other stop is mid-restore", async () => {
      const other = "agent-sales-bot";
      const harness = await killSwitchHarness({ otherAgents: ["sales-bot"] });
      const stopIds: string[] = [];
      for (const agentId of [AGENT_ID, other]) {
        await harness.plans.setPlan({
          organizationId: ORG,
          agentId,
          targets: [{ kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID }],
        });
        const view = await harness.stops.requestStop({
          organizationId: ORG,
          agentId,
          reason: "prompt injection in production",
          severity: "high",
          caller: PERSON,
        });
        stopIds.push(view.id);
        await settled(harness, view.id, "quarantined");
      }
      const [first = "", second = ""] = stopIds;
      // The second stop's restore folded, its revert not run yet: it is letting the key go.
      const read = await harness.repositories.agentStops.getStopWithCursor({
        organizationId: ORG,
        stopId: second,
      });
      await harness.repositories.agentStops.advance({
        stop: {
          ...read.stop,
          status: "restoring",
          targets: read.stop.targets.map((target) => ({ ...target, state: "reverting" })),
        },
        eventId: read.eventId,
      });
      const target = (await harness.stopOf(first)).targets[0];
      if (!target) throw new Error("the stop holds no target");

      await harness.targets.revertTarget(
        {
          stopId: first,
          organizationId: ORG,
          agentId: AGENT_ID,
          reason: "prompt injection in production",
          actorUserId: "user-ops",
          target: { id: target.id, label: target.label, target: target.target },
          restoreRound: 1,
        },
        {
          processName: "agentStop",
          projectId: ORG,
          processKey: first,
          tenantId: ORG,
          messageKey: `revert:${target.id}:1`,
          attempt: 1,
        },
      );

      expect(harness.virtualKeyCalls.at(-1)?.action).toBe("enable");
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      await harness.eventing.close();
    });
  });

  describe("given a restored stop and a newer stop of the same agent", () => {
    /** @scenario "A retried intent of an older round leaves the platform alone" */
    it("leaves every target as the newer stop set it when the old intents run again", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const older = await request(harness);
      await settled(harness, older.id, "quarantined");
      await harness.stops.restore({ organizationId: ORG, stopId: older.id, caller: PERSON });
      const restored = await settled(harness, older.id, "restored");
      const newer = await request(harness);
      await settled(harness, newer.id, "quarantined");
      const endpointCalls = harness.servingEndpoints.calls.length;
      const keyCalls = harness.virtualKeyCalls.length;
      const bedrockUpdates = harness.bedrock.updates.length;

      for (const target of restored.targets) {
        const work = {
          stopId: older.id,
          organizationId: ORG,
          agentId: AGENT_ID,
          reason: "prompt injection in production",
          actorUserId: "user-ops",
          target: { id: target.id, label: target.label, target: target.target },
        };
        const context = {
          processName: "agentStop",
          projectId: ORG,
          processKey: older.id,
          tenantId: ORG,
          messageKey: `retried:${target.id}`,
          attempt: 2,
        };
        await harness.targets.revertTarget({ ...work, restoreRound: 1 }, context);
        await harness.targets.applyTarget({ ...work, retryRound: 0 }, context);
      }

      expect(harness.servingEndpoints.calls).toHaveLength(endpointCalls);
      expect(harness.virtualKeyCalls).toHaveLength(keyCalls);
      expect(harness.bedrock.updates).toHaveLength(bedrockUpdates);
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).not.toBe("ACTIVE");
      expect((await harness.stopOf(older.id)).status).toBe("restored");
      await harness.eventing.close();
    });
  });
});

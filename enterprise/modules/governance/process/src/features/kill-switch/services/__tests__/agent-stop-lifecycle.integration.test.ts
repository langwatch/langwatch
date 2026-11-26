/**
 * How a stop's lifecycle requests and plan changes settle: the 202 a restore or retry answers, a
 * target the plan drops, a stop left with nothing, and shared keys two restores let go at once.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  AGENT_STOP_EVENT_TYPES,
  type AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryGovernanceRepositories } from "../../../../repositories/memory/memory.governance.repositories.ts";
import {
  presentPlatforms,
  seedRegistry,
} from "../../../../repositories/prisma/__tests__/prisma.kill-switch.fixtures.ts";
import { foldAgentStop } from "../../eventing/agent-stop.projection.ts";
import {
  type AgentStopRecord,
  requestedStop,
  targetAppliedStop,
} from "../../rules/agent-stop.rules.ts";
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

const EVENT_OF_COMMAND: Record<string, string> = {
  requestRestore: AGENT_STOP_EVENT_TYPES.RESTORE_REQUESTED,
  retry: AGENT_STOP_EVENT_TYPES.RETRY_REQUESTED,
};

/**
 * A stop service over memory whose sends reach no pipeline, so the projection never folds them:
 * the worst lag a request can meet. The stop is seeded quarantined; by default its plan gained a
 * key since, so a retry has something to apply. `events` holds what each send would append.
 */
async function laggingService({ planGainedTarget = true }: { planGainedTarget?: boolean } = {}) {
  const repositories = MemoryGovernanceRepositories.create();
  await seedRegistry({ memory: repositories, organizationId: ORG });
  await repositories.agentStopPlans.replaceTargets({
    organizationId: ORG,
    agentId: AGENT_ID,
    targets: [
      KEY_TARGET,
      ...(planGainedTarget
        ? [
            {
              id: "target-vk-new",
              label: "Virtual key vk-new",
              target: { kind: "gateway_virtual_key" as const, virtualKeyId: "vk-new" },
            },
          ]
        : []),
    ],
  });
  const sent: string[] = [];
  const events: { type: string; data: unknown; at: number }[] = [];
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
    send: async (name, payload) => {
      sent.push(name);
      events.push({ type: EVENT_OF_COMMAND[name] ?? name, data: payload, at: payload.occurredAt });
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
  return { service, sent, events, quarantined, repositories };
}

/** Folds events onto a stop one by one, as the projection and the process manager do. */
function foldAll({
  stop,
  events,
}: {
  stop: AgentStopRecord;
  events: readonly { type: string; data: unknown; at: number }[];
}) {
  return events.reduce<AgentStopRecord | null>(
    (folded, event) => foldAgentStop({ stop: folded, ...event }),
    stop,
  );
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

  describe("when a quarantined stop with nothing new is retried twice before the worker folds", () => {
    /** @scenario "A retry with nothing new to apply is counted once, however far the worker lags" */
    it("counts each retry once when the worker folds them onto the row", async () => {
      const { service, events, quarantined, repositories } = await laggingService({
        planGainedTarget: false,
      });

      await service.retryStop({ organizationId: ORG, stopId: "stop-1", caller: PERSON });
      await service.retryStop({ organizationId: ORG, stopId: "stop-1", caller: PERSON });
      const row = await repositories.agentStops.getStop({ organizationId: ORG, stopId: "stop-1" });
      const fromLog = foldAll({ stop: quarantined, events });
      const fromRow = foldAll({ stop: row, events });

      expect(fromLog).toMatchObject({ status: "quarantined", retryRound: 2 });
      expect(fromRow).toMatchObject({ status: "quarantined", retryRound: 2 });
      expect(fromRow?.lastRequestId).toBe(fromLog?.lastRequestId);
    });
  });

  describe("given a quarantined stop retried with nothing new to apply", () => {
    /** @scenario "A retry with nothing new to apply is counted once, however far the worker lags" */
    it("counts the retry once, so a later retry still applies the target the plan gained", async () => {
      const harness = await killSwitchHarness();
      await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.slice(1),
      });
      const view = await request(harness);
      await settled(harness, view.id, "quarantined");
      const cursorOf = async () =>
        (
          await harness.repositories.agentStops.getStopWithCursor({
            organizationId: ORG,
            stopId: view.id,
          })
        ).eventId;
      const before = await cursorOf();
      // A queued worker: the retry's event is folded only after the API advanced the row.
      const stops = harness.repositories.agentStops;
      const advance = stops.advance.bind(stops);
      let advanced = (): void => undefined;
      const advancedOnce = new Promise<void>((resolve) => (advanced = resolve));
      vi.spyOn(stops, "advance").mockImplementation(async (input) => {
        await advance(input);
        advanced();
      });
      const commands: Record<string, { send(payload: unknown): Promise<unknown> }> =
        harness.pipeline.commands;
      const retry = commands.retry;
      if (!retry) throw new Error("the pipeline has no retry command");
      const sendRetry = retry.send.bind(retry);
      const queued: Promise<unknown>[] = [];
      vi.spyOn(retry, "send").mockImplementation(async (payload) => {
        queued.push(advancedOnce.then(() => sendRetry(payload)));
      });

      await harness.stops.retryStop({ organizationId: ORG, stopId: view.id, caller: PERSON });
      await Promise.all(queued);
      await vi.waitFor(async () => expect(await cursorOf()).not.toBe(before));
      vi.restoreAllMocks();
      const folded = await harness.stopOf(view.id);
      await harness.setFullPlan();
      await harness.stops.retryStop({ organizationId: ORG, stopId: view.id, caller: PERSON });

      expect(folded).toMatchObject({ status: "quarantined", retryRound: 1 });
      const stop = await settled(harness, view.id, "quarantined");
      expect(stop.retryRound).toBe(2);
      expect(stop.targets).toHaveLength(3);
      expect(stop.targets.every((target) => target.state === "applied")).toBe(true);
      await harness.eventing.close();
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
        caller: PERSON,
      });
      await vi.waitFor(async () => expect((await harness.stopOf(view.id)).targets).toHaveLength(2));

      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect((await harness.stopOf(view.id)).status).toBe("quarantined");
      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      await settled(harness, view.id, "restored");
      expect(harness.virtualKeyCalls.map((call) => call.action)).toEqual(["disable", "enable"]);
    });

    /** @scenario "A restore asked while a drop's revert is redelivered still settles that revert" */
    it("lets the redelivered drop revert enable the key and settle the restore", async () => {
      const key = (await harness.stopOf(view.id)).targets.find(
        (target) => target.target.kind === "gateway_virtual_key",
      );
      if (!key) throw new Error("the stop holds no virtual key");
      harness.recordRefusals.set(key.id, 1);
      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.filter((target) => target.kind !== "gateway_virtual_key"),
        caller: PERSON,
      });
      await vi.waitFor(() => expect(harness.virtualKeyCalls).toHaveLength(2));
      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });

      await vi.waitFor(
        async () => expect((await harness.stopOf(view.id)).status).toBe("restored"),
        { timeout: 40_000, interval: 200 },
      );
      const restored = await harness.stopOf(view.id);
      expect(restored.targets.map((target) => target.id)).not.toContain(key.id);
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
    });

    /** @scenario "A stop whose plan lost every target closes as restored" */
    it("restores the stop once every target was dropped and reverted", async () => {
      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: [],
        caller: PERSON,
      });
      const restored = await settled(harness, view.id, "restored");

      expect(restored.targets).toEqual([]);
      expect(restored.quarantinedAt).not.toBeNull();
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect(harness.bedrock.updates.at(-1)?.aliasInvocationState).toBe("ACCEPT_INVOCATIONS");
    });
  });

  describe("given a stop waiting for approval whose plan loses every target", () => {
    /** @scenario "A stop whose plan lost every target closes as restored" */
    it("closes it as restored, announces and audits that, and accepts a new stop", async () => {
      const harness = await killSwitchHarness();
      const keyOnly = harness.fullPlan.filter((target) => target.kind === "gateway_virtual_key");
      await harness.plans.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: keyOnly });
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");

      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: [],
        caller: PERSON,
      });
      const closed = await settled(harness, view.id, "restored");
      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.plans.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: keyOnly });
      const next = await request(harness);

      expect(closed).toMatchObject({ targets: [], quarantinedAt: null });
      await vi.waitFor(() =>
        expect(harness.announced.map((event) => event.milestone)).toContain(
          "governance.agent.restored",
        ),
      );
      await vi.waitFor(() =>
        expect(
          harness.audit.filter((row) => row.action === "governance.agent.restored"),
        ).toHaveLength(1),
      );
      expect(next.id).not.toBe(view.id);
      await settled(harness, next.id, "quarantined");
      await harness.eventing.close();
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

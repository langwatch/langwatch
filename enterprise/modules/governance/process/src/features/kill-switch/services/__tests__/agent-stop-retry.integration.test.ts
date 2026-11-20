/**
 * Retrying a stop, and a plan change reaching the agent's open stop, through the real
 * `agent_stop` pipeline. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  type AgentStopProjectionState,
  foldAgentStop,
} from "../../eventing/agent-stop.projection.ts";
import {
  auditMomentOf,
  auditRowOf,
  codeOf,
  request,
  settled,
} from "./kill-switch-steps.fixtures.ts";
import {
  AGENT_ID,
  killSwitchHarness,
  ORG,
  PERSON,
  VIRTUAL_KEY_ID,
} from "./kill-switch.fixtures.ts";

const STOP_PATH = "/api/2.0/serving-endpoints/support-bot-prod/config:stop";
const START_PATH = "/api/2.0/serving-endpoints/support-bot-prod/config:start";

describe("AgentStopService retry", () => {
  describe("given a stop that failed because the serving endpoint refused to stop", () => {
    async function failedStop() {
      const harness = await killSwitchHarness({ maxAttempts: 2 });
      await harness.setFullPlan();
      harness.servingEndpoints.refuse({ path: STOP_PATH, code: "http_503" });
      const view = await request(harness);
      await settled(harness, view.id, "stop_failed");
      return { harness, stopId: view.id };
    }

    /** @scenario "A failed stop is retried on the targets it did not stop" */
    it("applies only the failed target again and quarantines the agent", async () => {
      const { harness, stopId } = await failedStop();
      harness.servingEndpoints.allow({ path: STOP_PATH });
      const keyCallsBefore = harness.virtualKeyCalls.length;

      const retrying = await harness.stops.retryStop({
        organizationId: ORG,
        stopId,
        caller: PERSON,
      });

      expect(retrying.status).toBe("stopping");
      const stop = await settled(harness, stopId, "quarantined");
      expect(stop.targets.every((target) => target.state === "applied")).toBe(true);
      expect(harness.virtualKeyCalls).toHaveLength(keyCallsBefore);
      expect(harness.bedrock.updates).toHaveLength(1);
      await vi.waitFor(() =>
        expect(harness.announced.map((event) => event.milestone)).toEqual([
          "governance.agent.stop_failed",
          "governance.agent.quarantined",
        ]),
      );
      expect(harness.audit.map((row) => row.action)).toContain("governance.agent.stop_retried");
      await harness.eventing.close();
    });

    /** @scenario "A request and the milestone it causes list in causal order, even in one second" */
    it("dates the quarantined row after the retry that caused it", async () => {
      const { harness, stopId } = await failedStop();
      harness.servingEndpoints.allow({ path: STOP_PATH });

      await harness.stops.retryStop({ organizationId: ORG, stopId, caller: PERSON });
      await settled(harness, stopId, "quarantined");
      await vi.waitFor(() =>
        expect(auditRowOf(harness, "governance.agent.quarantined")).toBeDefined(),
      );

      const retried = auditRowOf(harness, "governance.agent.stop_retried");
      const quarantined = auditRowOf(harness, "governance.agent.quarantined");
      expect(auditMomentOf(quarantined)).toBeGreaterThan(auditMomentOf(retried));
      await harness.eventing.close();
    });

    /** @scenario "A retry that fails again announces the failure again" */
    it("records the target failed again and announces a second stop_failed", async () => {
      const { harness, stopId } = await failedStop();

      await harness.stops.retryStop({ organizationId: ORG, stopId, caller: PERSON });

      await settled(harness, stopId, "stop_failed");
      await vi.waitFor(
        () =>
          expect(harness.announced.map((event) => event.milestone)).toEqual([
            "governance.agent.stop_failed",
            "governance.agent.stop_failed",
          ]),
        { timeout: 5_000 },
      );
      expect(new Set(harness.announced.map((event) => event.eventId)).size).toBe(2);
      await harness.eventing.close();
    });

    /** @scenario "A failed target removed from the plan no longer fails the stop" */
    it("quarantines the stop once the failed endpoint leaves the plan", async () => {
      const { harness, stopId } = await failedStop();

      await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.slice(1),
      });
      await harness.stops.dropRemovedTargets({
        organizationId: ORG,
        agentId: AGENT_ID,
        plan: (await harness.plans.getPlan({ organizationId: ORG, agentId: AGENT_ID })).targets,
      });

      const stop = await settled(harness, stopId, "quarantined");
      expect(stop.targets.map((target) => target.target.kind)).toEqual([
        "bedrock_agent_alias",
        "gateway_virtual_key",
      ]);
      await harness.eventing.close();
    });
  });

  describe("given a restore that failed because the endpoint refused to start", () => {
    async function failedRestore() {
      const harness = await killSwitchHarness({ maxAttempts: 2 });
      await harness.setFullPlan();
      const view = await request(harness);
      await settled(harness, view.id, "quarantined");
      harness.servingEndpoints.refuse({ path: START_PATH, code: "http_503" });
      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      await settled(harness, view.id, "restore_failed");
      return { harness, stopId: view.id };
    }

    /** @scenario "A stop whose restore failed can be stopped again" */
    it("stops again what the restore turned back on and quarantines the agent", async () => {
      const { harness, stopId } = await failedRestore();

      await harness.stops.retryStop({ organizationId: ORG, stopId, caller: PERSON });

      const stop = await settled(harness, stopId, "quarantined");
      expect(stop.targets.every((target) => target.state === "applied")).toBe(true);
      expect(harness.keyStatuses.get("vk-support-bot")).toBe("DISABLED");
      expect(harness.bedrock.updates.at(-1)?.aliasInvocationState).toBe("REJECT_INVOCATIONS");
      await harness.eventing.close();
    });

    /** @scenario "A target removed from the plan no longer holds a failed restore" */
    it("restores the stop once the deleted endpoint leaves the plan", async () => {
      const { harness, stopId } = await failedRestore();
      harness.servingEndpoints.refuse({ path: START_PATH, code: "http_404" });

      const plan = await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.slice(1),
      });
      await harness.stops.dropRemovedTargets({
        organizationId: ORG,
        agentId: AGENT_ID,
        plan: plan.targets,
      });

      const stop = await settled(harness, stopId, "restored");
      expect(stop.targets.map((target) => target.state)).toEqual(["reverted", "reverted"]);
      await harness.eventing.close();
    });
  });

  describe("given a quarantined stop whose plan gained a target", () => {
    /** @scenario "Stopping a quarantined agent again applies the targets added to its plan" */
    it("applies only the new target", async () => {
      const harness = await killSwitchHarness();
      await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan.slice(1),
      });
      const view = await request(harness);
      await settled(harness, view.id, "quarantined");
      await harness.setFullPlan();

      await harness.stops.retryStop({ organizationId: ORG, stopId: view.id, caller: PERSON });

      await vi.waitFor(async () => expect((await harness.stopOf(view.id)).targets).toHaveLength(3));
      const stop = await settled(harness, view.id, "quarantined");
      expect(stop.targets.every((target) => target.state === "applied")).toBe(true);
      expect(harness.servingEndpoints.calls.map((call) => call.path)).toEqual([STOP_PATH]);
      expect(harness.bedrock.updates).toHaveLength(1);
      await harness.eventing.close();
    });
  });

  describe("given a stop waiting for an approval", () => {
    /** @scenario "Only a quarantined or failed stop can be retried" */
    it("refuses the retry with agent_stop_not_retryable", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, { userId: "user-key-owner", apiKeyId: "key-a" });

      expect(
        await codeOf(
          harness.stops.retryStop({ organizationId: ORG, stopId: view.id, caller: PERSON }),
        ),
      ).toBe("agent_stop_not_retryable");
      await harness.eventing.close();
    });
  });
  describe("when a retry and a restore of a failed stop race", () => {
    /** @scenario "A restore that races a retry is refused by the stop and the next restore reverts" */
    it("keeps the stop reachable and a later restore reverts, live and rebuilt alike", async () => {
      const harness = await killSwitchHarness({ maxAttempts: 2 });
      await harness.setFullPlan();
      harness.servingEndpoints.refuse({ path: STOP_PATH, code: "http_503" });
      const view = await request(harness);
      await settled(harness, view.id, "stop_failed");
      harness.servingEndpoints.allow({ path: STOP_PATH });

      const answers = await Promise.allSettled([
        harness.stops.retryStop({ organizationId: ORG, stopId: view.id, caller: PERSON }),
        harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON }),
      ]);
      // The lock orders the two; the second is refused unless the first already settled.
      expect(answers.filter((answer) => answer.status === "fulfilled").length).toBeGreaterThan(0);
      const refused = answers.flatMap((answer) =>
        answer.status === "rejected" ? [(answer.reason as { code?: string }).code] : [],
      );
      for (const code of refused) {
        expect(["agent_stop_not_retryable", "agent_stop_not_restorable"]).toContain(code);
      }
      const raced = await vi.waitFor(
        async () => {
          const stop = await harness.stopOf(view.id);
          expect(["quarantined", "restored", "restore_failed"]).toContain(stop.status);
          return stop;
        },
        { timeout: 5_000 },
      );
      if (raced.status === "quarantined") {
        await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      }
      const restored = await settled(harness, view.id, "restored");

      expect(restored.restoreRound).toBe(1);
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      const events = await harness.eventStore.getEvents({
        aggregateId: view.id,
        context: { tenantId: createTenantId(ORG) },
        aggregateType: "agent_stop",
      });
      const rebuilt = events.reduce<AgentStopProjectionState>(
        (stop, event) =>
          foldAgentStop({ stop, type: event.type, data: event.data, at: event.occurredAt }),
        null,
      );
      expect(rebuilt?.status).toBe(restored.status);
      expect(rebuilt?.restoreRound).toBe(restored.restoreRound);
      expect(rebuilt?.retryRound).toBe(restored.retryRound);
      await harness.eventing.close();
    });
  });
});

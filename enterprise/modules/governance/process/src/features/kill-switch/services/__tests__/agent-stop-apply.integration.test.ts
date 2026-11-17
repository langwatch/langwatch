/**
 * The worker applying each target of a stop through the real `agent_stop` pipeline.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { AGENT_STOP_MAX_ATTEMPTS } from "../../eventing/agent-stop.process.ts";
import { request, settled } from "./kill-switch-steps.fixtures.ts";
import {
  AGENT_ID,
  killSwitchHarness,
  ORG,
  PERSON,
  VIRTUAL_KEY_ID,
  WORKSPACE,
  WORKSPACE_TOKEN,
} from "./kill-switch.fixtures.ts";

describe("AgentStopTargetService", () => {
  describe("when a stop is applied", () => {
    /** @scenario "A Databricks serving endpoint target stops the endpoint through its workspace" */
    it("asks the workspace to stop the serving endpoint with the source's token", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);
      await settled(harness, view.id, "quarantined");

      expect(harness.servingEndpoints.calls).toEqual([
        {
          workspaceUrl: WORKSPACE,
          token: WORKSPACE_TOKEN,
          path: "/api/2.0/serving-endpoints/support-bot-prod/config:stop",
        },
      ]);
      await harness.eventing.close();
    });

    /** @scenario "A Bedrock agent alias target rejects invocations, keeping the alias's name and routing" */
    it("reads the alias, then updates it right after a second read with its own name and routing", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);
      await settled(harness, view.id, "quarantined");

      expect(harness.bedrock.reads).toEqual([
        { agentId: "AGENT00001", agentAliasId: "ALIAS00001" },
        { agentId: "AGENT00001", agentAliasId: "ALIAS00001" },
      ]);
      expect(harness.bedrock.updates).toEqual([
        {
          region: "eu-west-1",
          agentId: "AGENT00001",
          agentAliasId: "ALIAS00001",
          agentAliasName: "live",
          description: "support-bot live alias",
          routingConfiguration: [{ agentVersion: "7" }],
          aliasInvocationState: "REJECT_INVOCATIONS",
        },
      ]);
      await harness.eventing.close();
    });

    /** @scenario "A virtual key target disables the key with the stop's reason" */
    it("disables the key with a reason naming the stop", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);
      await settled(harness, view.id, "quarantined");

      expect(harness.virtualKeyCalls).toEqual([
        {
          action: "disable",
          input: {
            id: VIRTUAL_KEY_ID,
            organizationId: ORG,
            actorUserId: PERSON.userId,
            reason: `kill switch stop ${view.id}: prompt injection in production`,
          },
        },
      ]);
      await harness.eventing.close();
    });

    /** @scenario "All targets applied quarantine the agent" */
    it("quarantines the agent, pushes one quarantined event with every outcome and audits it", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);
      await settled(harness, view.id, "quarantined");

      await vi.waitFor(() => expect(harness.announced).toHaveLength(1));
      const [event] = harness.announced;
      expect(event?.milestone).toBe("governance.agent.quarantined");
      expect(event?.stop.targets.map((target) => target.state)).toEqual([
        "applied",
        "applied",
        "applied",
      ]);
      await vi.waitFor(() =>
        expect(harness.audit.map((row) => row.action)).toContain("governance.agent.quarantined"),
      );
      const row = harness.audit.find((entry) => entry.action === "governance.agent.quarantined");
      expect(row?.targetKind).toBe("governance_agent");
      expect(row?.targetId).toBe(AGENT_ID);
      await harness.eventing.close();
    });

    /** @scenario "A target the platform refuses is retried, then recorded as failed" */
    it("retries a refused Bedrock target, records it failed with the error name and fails the stop", async () => {
      const { logger, lines } = createTestLogger();
      const harness = await killSwitchHarness({ maxAttempts: 3, logger });
      await harness.setFullPlan();
      harness.bedrock.refuseWith("ThrottlingException");

      const view = await request(harness);
      const stop = await settled(harness, view.id, "stop_failed");

      const bedrock = stop.targets.find((target) => target.target.kind === "bedrock_agent_alias");
      expect(bedrock?.state).toBe("failed");
      expect(bedrock?.errorCode).toBe("ThrottlingException");
      expect(
        stop.targets
          .filter((target) => target.state === "applied")
          .map((target) => target.target.kind),
      ).toEqual(["databricks_serving_endpoint", "gateway_virtual_key"]);
      await vi.waitFor(() => expect(harness.announced).toHaveLength(1));
      expect(harness.announced[0]?.milestone).toBe("governance.agent.stop_failed");
      expect(lines.findLine("warn", "failed on its last attempt")).toMatchObject({
        stopId: view.id,
        targetId: bedrock?.id,
        errorCode: "ThrottlingException",
      });
      await harness.eventing.close();
    });
  });

  describe("when an apply intent is retried after its platform call succeeded", () => {
    async function retriedAfterSuccess() {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, PERSON, "critical");
      const stop = await settled(harness, view.id, "quarantined");
      harness.keyRefusals.set("disable", "virtual_key_unavailable");
      const context = {
        processName: "agentStop",
        projectId: ORG,
        processKey: view.id,
        tenantId: ORG,
        attempt: 2,
      };
      for (const target of stop.targets) {
        await harness.targets.applyTarget(
          {
            stopId: view.id,
            organizationId: ORG,
            agentId: stop.agentId,
            reason: "prompt injection in production",
            actorUserId: "user-ops",
            target: { id: target.id, label: target.label, target: target.target },
            retryRound: 0,
          },
          { ...context, messageKey: `apply:${target.id}` },
        );
      }
      return { harness, stopId: view.id };
    }

    /** @scenario "A retried apply after a successful platform call still counts the change as the stop's own" */
    it("keeps the key and the alias as changed by the stop, so the restore reverts both", async () => {
      const { harness, stopId } = await retriedAfterSuccess();
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("DISABLED");
      expect(harness.virtualKeyCalls.filter((call) => call.action === "disable")).toHaveLength(1);
      harness.keyRefusals.delete("disable");

      await harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON });
      const restored = await settled(harness, stopId, "restored");

      expect(restored.targets.every((target) => !target.alreadyStopped)).toBe(true);
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect(
        harness.bedrock.getAlias({ agentId: "AGENT00001", agentAliasId: "ALIAS00001" })
          .aliasInvocationState,
      ).toBe("ACCEPT_INVOCATIONS");
      await harness.eventing.close();
    });
  });

  describe("when recording an outcome fails on the platform's last attempt", () => {
    /** @scenario "An outcome whose first record fails is recorded on a later delivery" */
    it("settles the stop on a later delivery past the platform attempt budget", async () => {
      const harness = await killSwitchHarness({ maxAttempts: AGENT_STOP_MAX_ATTEMPTS });
      const plan = await harness.setFullPlan();
      const [first] = plan.targets;
      if (!first) throw new Error("the plan holds no target");
      harness.recordRefusals.set(first.id, AGENT_STOP_MAX_ATTEMPTS);

      const view = await request(harness, PERSON, "critical");

      // Each redelivery waits for the outbox's next drain, so this stop settles in seconds.
      await vi.waitFor(
        async () => expect((await harness.stopOf(view.id)).status).toBe("quarantined"),
        { timeout: 40_000, interval: 200 },
      );
      const stop = await harness.stopOf(view.id);
      expect(stop.targets.every((target) => target.state === "applied")).toBe(true);
      await harness.eventing.close();
    });
  });
});

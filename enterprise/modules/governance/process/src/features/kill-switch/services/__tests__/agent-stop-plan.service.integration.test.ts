/**
 * The stop plan's refusals and a redelivered apply intent, through the real `agent_stop` pipeline.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_ID,
  killSwitchHarness,
  ORG,
  PERSON,
  VIRTUAL_KEY_ID,
} from "./kill-switch.fixtures.ts";

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; meta?: Record<string, unknown> };
  }
  return undefined;
}

describe("AgentStopPlanService", () => {
  describe("when the plan names a virtual key the organisation does not hold", () => {
    /** @scenario "A stop plan naming a virtual key of another organisation is refused" */
    it("refuses the write by the target's position", async () => {
      const harness = await killSwitchHarness();

      const refusal = await refusalOf(
        harness.plans.setPlan({
          organizationId: ORG,
          agentId: AGENT_ID,
          targets: [
            { kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID },
            { kind: "gateway_virtual_key", virtualKeyId: "vk-other-organisation" },
          ],
        }),
      );

      expect(refusal?.code).toBe("agent_stop_target_invalid");
      expect(refusal?.meta).toMatchObject({ position: 1, reason: "virtual_key_not_found" });
      expect(
        (await harness.plans.getPlan({ organizationId: ORG, agentId: AGENT_ID })).targets,
      ).toEqual([]);
      await harness.eventing.close();
    });
  });

  describe("when the plan names a Copilot Studio source for a serving endpoint", () => {
    /** @scenario "A stop plan naming a Databricks source that is not Databricks is refused" */
    it("refuses the write", async () => {
      const harness = await killSwitchHarness();

      const refusal = await refusalOf(
        harness.plans.setPlan({
          organizationId: ORG,
          agentId: AGENT_ID,
          targets: [
            {
              kind: "databricks_serving_endpoint",
              ingestionSourceId: harness.copilotSource.id,
              endpointName: "support-bot-prod",
            },
          ],
        }),
      );

      expect(refusal?.code).toBe("agent_stop_target_invalid");
      expect(refusal?.meta).toMatchObject({ position: 0, reason: "source_not_databricks" });
      await harness.eventing.close();
    });
  });

  describe("when the plan names an AWS connection the organisation does not hold", () => {
    it("refuses the write", async () => {
      const harness = await killSwitchHarness();

      const refusal = await refusalOf(
        harness.plans.setPlan({
          organizationId: ORG,
          agentId: AGENT_ID,
          targets: [
            {
              kind: "bedrock_agent_alias",
              awsConnectionId: "awsconn-other-organisation",
              region: "eu-west-1",
              agentId: "AGENT00001",
              agentAliasId: "ALIAS00001",
            },
          ],
        }),
      );

      expect(refusal?.meta).toMatchObject({ position: 0, reason: "aws_connection_not_found" });
      await harness.eventing.close();
    });
  });

  describe("when another organisation writes the plan of this organisation's agent", () => {
    it("refuses it as outside its registry", async () => {
      const harness = await killSwitchHarness();

      const refusal = await refusalOf(
        harness.plans.setPlan({ organizationId: "org-2", agentId: AGENT_ID, targets: [] }),
      );

      expect(refusal?.code).toBe("agent_registry_entry_not_found");
      await harness.eventing.close();
    });
  });
});

describe("AgentStopTargetService", () => {
  describe("when a target's apply intent is delivered twice", () => {
    /** @scenario "A redelivered apply intent stops each target once" */
    it("records the target's applied event once", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await harness.stops.requestStop({
        organizationId: ORG,
        agentId: AGENT_ID,
        reason: "redelivery",
        severity: "critical",
        caller: PERSON,
      });
      await vi.waitFor(async () =>
        expect((await harness.stopOf(view.id)).status).toBe("quarantined"),
      );
      const [first] = view.targets;
      if (!first) throw new Error("the plan holds no target");
      const intent = {
        stopId: view.id,
        organizationId: ORG,
        agentId: AGENT_ID,
        reason: "redelivery",
        actorUserId: "user-ops",
        target: { id: first.id, label: first.label, target: first.target },
        retryRound: 0,
      };
      const context = {
        processName: "agentStop",
        projectId: ORG,
        processKey: view.id,
        tenantId: ORG,
        messageKey: `apply:${first.id}`,
        attempt: 1,
      };

      await harness.targets.applyTarget(intent, context);

      const events = await harness.eventStore.getEvents({
        aggregateId: view.id,
        context: { tenantId: createTenantId(ORG) },
        aggregateType: "agent_stop",
      });
      const applied = events.filter(
        (event) =>
          event.type === "lw.governance.agent_stop.target_applied" &&
          (event.data as { targetId: string }).targetId === first.id,
      );
      expect(applied).toHaveLength(1);
      await harness.eventing.close();
    });
  });
});

/**
 * The stop plan's refusals and a redelivered apply intent, through the real `agent_stop` pipeline.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { AgentRegistryEntryNotFoundError } from "@langwatch/enterprise-governance-contract";
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

  describe("when the plan names a target its platform does not find", () => {
    /** @scenario "A stop plan naming a target its platform does not find is refused" */
    it("refuses an unknown Bedrock alias and a missing serving endpoint by position", async () => {
      const harness = await killSwitchHarness();
      const [endpoint, alias] = harness.fullPlan;
      if (
        endpoint?.kind !== "databricks_serving_endpoint" ||
        alias?.kind !== "bedrock_agent_alias"
      ) {
        throw new Error("the full plan starts with the endpoint and the alias");
      }
      harness.probes.servingEndpoints.refuse({
        path: "/api/2.0/serving-endpoints/support-bot-prod",
        code: "http_404",
      });

      const missingEndpoint = await refusalOf(
        harness.plans.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: [endpoint] }),
      );
      const wrongRegion = await refusalOf(
        harness.plans.setPlan({
          organizationId: ORG,
          agentId: AGENT_ID,
          targets: [
            { kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID },
            { ...alias, agentAliasId: "ALIAS99999" },
          ],
        }),
      );

      expect(missingEndpoint).toMatchObject({
        code: "agent_stop_target_not_found",
        meta: { position: 0, kind: "databricks_serving_endpoint" },
      });
      expect(wrongRegion).toMatchObject({
        code: "agent_stop_target_not_found",
        meta: { position: 1, kind: "bedrock_agent_alias" },
      });
      expect(
        (await harness.plans.getPlan({ organizationId: ORG, agentId: AGENT_ID })).targets,
      ).toEqual([]);
      await harness.eventing.close();
    });

    it("saves the plan when the platform fails for another reason", async () => {
      const harness = await killSwitchHarness();
      harness.probes.servingEndpoints.refuse({
        path: "/api/2.0/serving-endpoints/support-bot-prod",
        code: "http_503",
      });

      const plan = await harness.setFullPlan();

      expect(plan.targets).toHaveLength(3);
      await harness.eventing.close();
    });
  });

  describe("when a plan save waits on a slow platform", () => {
    /** @scenario "A plan save checks its platforms before it takes the agent's lock" */
    it("lets a stop of the same agent through while the platform answers", async () => {
      const harness = await killSwitchHarness();
      await harness.plans.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: [{ kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID }],
      });
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });
      let asked: () => void = () => undefined;
      const platformAsked = new Promise<void>((resolve) => {
        asked = resolve;
      });
      const probe = harness.probes.bedrock.getInvocationState.bind(harness.probes.bedrock);
      vi.spyOn(harness.probes.bedrock, "getInvocationState").mockImplementation(async (input) => {
        asked();
        await answered;
        return probe(input);
      });

      const save = harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: harness.fullPlan,
        caller: PERSON,
      });
      await platformAsked;
      const stop = await Promise.race([
        harness.stops.requestStop({
          organizationId: ORG,
          agentId: AGENT_ID,
          reason: "prompt injection in production",
          severity: "high",
          caller: PERSON,
        }),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
      ]);
      answer();
      const plan = await save;

      expect(stop).not.toBe("blocked");
      expect(stop).toMatchObject({ agentId: AGENT_ID });
      expect(plan.targets).toHaveLength(3);
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

  describe("when a person saves the plan", () => {
    /** @scenario "Saving a stop plan writes one audit row naming the agent" */
    it("writes one stop_plan_set row naming the agent and who saved it, refused saves included", async () => {
      const harness = await killSwitchHarness();
      const keyOnly = [{ kind: "gateway_virtual_key" as const, virtualKeyId: VIRTUAL_KEY_ID }];

      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: keyOnly,
        caller: PERSON,
      });
      const refusal = await refusalOf(
        harness.stops.setPlan({
          organizationId: ORG,
          agentId: AGENT_ID,
          targets: keyOnly,
          expectedVersion: 0,
          caller: PERSON,
        }),
      );

      expect(refusal?.code).toBe("agent_stop_plan_conflict");
      expect(harness.audit).toEqual([
        expect.objectContaining({
          action: "governance.agent.stop_plan_set",
          userId: PERSON.userId,
          targetKind: "governance_agent",
          targetId: AGENT_ID,
          metadata: expect.objectContaining({
            targetName: "support-bot",
            version: 1,
            targets: [`Virtual key ${VIRTUAL_KEY_ID}`],
          }),
        }),
        expect.objectContaining({
          action: "governance.agent.stop_plan_set",
          error: "agent_stop_plan_conflict",
          targetId: AGENT_ID,
          metadata: expect.objectContaining({ targetName: "support-bot" }),
        }),
      ]);
      expect(harness.audit[0]?.error).toBeUndefined();
      await harness.eventing.close();
    });

    /** @scenario "Saving a stop plan writes one audit row naming the agent" */
    it("never audits a saved plan as refused when a read after the save fails", async () => {
      const harness = await killSwitchHarness();
      const keyOnly = [{ kind: "gateway_virtual_key" as const, virtualKeyId: VIRTUAL_KEY_ID }];
      const registry = harness.repositories.agentRegistry;
      const getEntry = registry.getEntry.bind(registry);
      vi.spyOn(registry, "getEntry").mockImplementation(async (input) => {
        const saved = await harness.plans.findTargets({ organizationId: ORG, agentId: AGENT_ID });
        if (saved.length > 0) throw new AgentRegistryEntryNotFoundError(input.id);
        return getEntry(input);
      });

      const plan = await harness.stops.setPlan({
        organizationId: ORG,
        agentId: AGENT_ID,
        targets: keyOnly,
        caller: PERSON,
      });

      expect(plan.targets).toHaveLength(1);
      expect(harness.audit.map((row) => [row.action, row.error])).toEqual([
        ["governance.agent.stop_plan_set", undefined],
      ]);
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

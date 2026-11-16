/**
 * A stop's whole life over memory: request, approval, the worker applying each target through the
 * real `agent_stop` pipeline, failures, restore and the audit trail.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopSeverity, AgentStopStatus } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_ID,
  killSwitchHarness,
  MACHINE,
  ORG,
  OTHER_MACHINE,
  PERSON,
  VIRTUAL_KEY_ID,
  WORKSPACE,
  WORKSPACE_TOKEN,
} from "./kill-switch.fixtures.ts";

type Harness = Awaited<ReturnType<typeof killSwitchHarness>>;

async function settled(harness: Harness, stopId: string, status: AgentStopStatus) {
  await vi.waitFor(async () => expect((await harness.stopOf(stopId)).status).toBe(status), {
    timeout: 5_000,
  });
  return harness.stopOf(stopId);
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const request = (harness: Harness, caller = PERSON, severity: AgentStopSeverity = "high") =>
  harness.stops.requestStop({
    organizationId: ORG,
    agentId: AGENT_ID,
    reason: "prompt injection in production",
    severity,
    caller,
  });

describe("AgentStopService", () => {
  describe("when a person with governance:manage presses Stop", () => {
    /** @scenario "A person with governance:manage pressing Stop stops at once" */
    it("requests an immediate stop and applies every target of the plan", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);

      expect(view.approval).toBe("immediate");
      expect(view.trigger).toBe("user");
      const stop = await settled(harness, view.id, "quarantined");
      expect(stop.targets.map((target) => target.state)).toEqual(["applied", "applied", "applied"]);
      await harness.eventing.close();
    });
  });

  describe("when an API key requests a critical stop", () => {
    /** @scenario "A critical stop from a machine credential stops at once" */
    it("applies every target without an approval", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness, MACHINE, "critical");

      expect(view.approval).toBe("immediate");
      expect(view.trigger).toBe("api_key");
      const stop = await settled(harness, view.id, "quarantined");
      expect(stop.decidedAt).toBeNull();
      await harness.eventing.close();
    });
  });

  describe("when an API key requests a high severity stop", () => {
    /** @scenario "A non-critical stop from a machine credential waits for an approval" */
    it("waits for an approval, applies nothing and pushes one stop_requested event", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness, MACHINE, "high");

      expect(view.status).toBe("pending_approval");
      await vi.waitFor(() => expect(harness.announced).toHaveLength(1));
      expect(harness.announced[0]?.milestone).toBe("governance.agent.stop_requested");
      expect((await harness.stopOf(view.id)).status).toBe("pending_approval");
      expect(harness.servingEndpoints.calls).toEqual([]);
      expect(harness.bedrock.updates).toEqual([]);
      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.eventing.close();
    });
  });

  describe("given a stop pending approval", () => {
    async function pending() {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");
      return { harness, stopId: view.id };
    }

    /** @scenario "Approving a pending stop applies its targets" */
    it("applies every target once a person approves it", async () => {
      const { harness, stopId } = await pending();

      const approved = await harness.stops.approveStop({
        organizationId: ORG,
        stopId,
        caller: PERSON,
      });

      expect(approved.status).toBe("stopping");
      const stop = await settled(harness, stopId, "quarantined");
      expect(stop.decidedByUserId).toBe(PERSON.userId);
      await harness.eventing.close();
    });

    /** @scenario "Denying a pending stop applies nothing" */
    it("applies nothing once a person denies it", async () => {
      const { harness, stopId } = await pending();

      await harness.stops.denyStop({ organizationId: ORG, stopId, caller: PERSON });

      const stop = await settled(harness, stopId, "denied");
      expect(stop.targets.every((target) => target.state === "pending")).toBe(true);
      expect(harness.servingEndpoints.calls).toEqual([]);
      expect(harness.virtualKeyCalls).toEqual([]);
      await harness.eventing.close();
    });

    /** @scenario "A decision on a stop that is no longer pending is refused" */
    it("refuses a second approval or a denial after the approval", async () => {
      const { harness, stopId } = await pending();
      await harness.stops.approveStop({ organizationId: ORG, stopId, caller: PERSON });
      await settled(harness, stopId, "quarantined");

      const decide = { organizationId: ORG, stopId, caller: OTHER_MACHINE };
      expect(await codeOf(harness.stops.approveStop(decide))).toBe("agent_stop_not_pending");
      expect(await codeOf(harness.stops.denyStop(decide))).toBe("agent_stop_not_pending");
      await harness.eventing.close();
    });

    /** @scenario "The credential that requested a stop cannot approve it" */
    it("refuses the approval of the API key that requested it", async () => {
      const { harness, stopId } = await pending();

      const code = await codeOf(
        harness.stops.approveStop({ organizationId: ORG, stopId, caller: MACHINE }),
      );

      expect(code).toBe("agent_stop_self_approval");
      await harness.eventing.close();
    });

    /** @scenario "Restoring a stop that is not quarantined is refused" */
    it("refuses a restore", async () => {
      const { harness, stopId } = await pending();

      const code = await codeOf(
        harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON }),
      );

      expect(code).toBe("agent_stop_not_restorable");
      await harness.eventing.close();
    });
  });

  describe("when another stop is requested while one is open", () => {
    /** @scenario "A second stop while one is open is refused" */
    it("refuses it for a pending, a stopping or a quarantined stop", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const pending = await request(harness, MACHINE, "high");
      await settled(harness, pending.id, "pending_approval");

      expect(await codeOf(request(harness))).toBe("agent_stop_already_open");

      await harness.stops.approveStop({ organizationId: ORG, stopId: pending.id, caller: PERSON });
      await settled(harness, pending.id, "quarantined");
      expect(await codeOf(request(harness))).toBe("agent_stop_already_open");
      await harness.eventing.close();
    });
  });

  describe("when the agent has no stop plan", () => {
    /** @scenario "An agent with no stop plan yet still offers its kill switch actions" */
    it("still answers a summary for it, so its first plan can be set", async () => {
      const harness = await killSwitchHarness();

      const summaries = await harness.stops.findSummaries({ organizationId: ORG });

      expect(summaries).toEqual([
        {
          agentId: AGENT_ID,
          inventoryRowId: "registered:support-bot",
          planTargetCount: 0,
          openStop: null,
        },
      ]);
      await harness.eventing.close();
    });

    /** @scenario "A stop of an agent with no stop plan is refused" */
    it("refuses the request", async () => {
      const harness = await killSwitchHarness();

      expect(await codeOf(request(harness))).toBe("agent_stop_plan_empty");
      await harness.eventing.close();
    });
  });

  describe("when the agent is not in the registry", () => {
    /** @scenario "A stop of an agent outside the registry is refused" */
    it("refuses the request", async () => {
      const harness = await killSwitchHarness();

      const code = await codeOf(
        harness.stops.requestStop({
          organizationId: ORG,
          agentId: "agent-unknown",
          reason: "r",
          severity: "critical",
          caller: PERSON,
        }),
      );

      expect(code).toBe("agent_registry_entry_not_found");
      await harness.eventing.close();
    });
  });

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
    it("reads the alias and updates it to reject invocations with its own name and routing", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();

      const view = await request(harness);
      await settled(harness, view.id, "quarantined");

      expect(harness.bedrock.reads).toEqual([
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
      const harness = await killSwitchHarness({ maxAttempts: 3 });
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
      await harness.eventing.close();
    });
  });

  describe("given a stop whose virtual key target failed and whose other targets were applied", () => {
    async function partlyStopped({ refuseStart = false } = {}) {
      const harness = await killSwitchHarness({ maxAttempts: 2 });
      await harness.setFullPlan();
      harness.keyRefusals.set("disable", "virtual_key_revoked");
      const view = await request(harness);
      await settled(harness, view.id, "stop_failed");
      if (refuseStart) {
        harness.servingEndpoints.refuse({
          path: "/api/2.0/serving-endpoints/support-bot-prod/config:start",
          code: "http_503",
        });
      }
      return { harness, stopId: view.id };
    }

    /** @scenario "Restore reverts only the targets the stop applied" */
    it("starts the endpoint, accepts invocations again, leaves the key alone and restores", async () => {
      const { harness, stopId } = await partlyStopped();

      const restoring = await harness.stops.restore({
        organizationId: ORG,
        stopId,
        caller: PERSON,
      });

      expect(restoring.status).toBe("restoring");
      const stop = await settled(harness, stopId, "restored");
      expect(harness.servingEndpoints.calls.map((call) => call.path)).toEqual([
        "/api/2.0/serving-endpoints/support-bot-prod/config:stop",
        "/api/2.0/serving-endpoints/support-bot-prod/config:start",
      ]);
      expect(harness.bedrock.updates.map((update) => update.aliasInvocationState)).toEqual([
        "REJECT_INVOCATIONS",
        "ACCEPT_INVOCATIONS",
      ]);
      expect(harness.virtualKeyCalls.some((call) => call.action === "enable")).toBe(false);
      expect(stop.restoredByUserId).toBe(PERSON.userId);
      await vi.waitFor(() =>
        expect(harness.announced.map((event) => event.milestone)).toEqual([
          "governance.agent.stop_failed",
          "governance.agent.restored",
        ]),
      );
      await harness.eventing.close();
    });

    /** @scenario "A target that cannot be reverted leaves the stop restore failed" */
    it("leaves the stop restore failed when the endpoint refuses to start", async () => {
      const { harness, stopId } = await partlyStopped({ refuseStart: true });

      await harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON });

      const stop = await settled(harness, stopId, "restore_failed");
      const endpoint = stop.targets.find(
        (target) => target.target.kind === "databricks_serving_endpoint",
      );
      expect(endpoint).toMatchObject({ state: "revert_failed", errorCode: "http_503" });
      await vi.waitFor(() =>
        expect(harness.announced.map((event) => event.milestone)).toContain(
          "governance.agent.restore_failed",
        ),
      );
      await harness.eventing.close();
    });
  });

  describe("given a virtual key already disabled and a Bedrock alias already rejecting calls", () => {
    /** @scenario "A target already stopped before the stop is left as it was on restore" */
    it("records both applied without changing them and leaves them stopped on restore", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      harness.keyStatuses.set(VIRTUAL_KEY_ID, "DISABLED");
      harness.bedrock.seed({
        agentId: "AGENT00001",
        agentAliasId: "ALIAS00001",
        alias: {
          agentAliasName: "live",
          description: "support-bot live alias",
          routingConfiguration: [{ agentVersion: "7" }],
          aliasInvocationState: "REJECT_INVOCATIONS",
        },
      });

      const view = await request(harness);
      const stopped = await settled(harness, view.id, "quarantined");
      expect(
        stopped.targets.map((target) => [target.state, target.alreadyStopped ?? false]),
      ).toEqual([
        ["applied", false],
        ["applied", true],
        ["applied", true],
      ]);
      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      const restored = await settled(harness, view.id, "restored");

      expect(restored.targets.map((target) => target.state)).toEqual([
        "reverted",
        "reverted",
        "reverted",
      ]);
      expect(harness.virtualKeyCalls).toEqual([]);
      expect(harness.bedrock.updates).toEqual([]);
      expect(harness.servingEndpoints.calls.map((call) => call.path)).toEqual([
        "/api/2.0/serving-endpoints/support-bot-prod/config:stop",
        "/api/2.0/serving-endpoints/support-bot-prod/config:start",
      ]);
      await harness.eventing.close();
    });
  });

  describe("when a stop is requested, approved and later restored", () => {
    /** @scenario "Request, approval, denial and restore each write an audit row" */
    it("audits every step with the agent as target", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");
      await harness.stops.approveStop({ organizationId: ORG, stopId: view.id, caller: PERSON });
      await settled(harness, view.id, "quarantined");
      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      await settled(harness, view.id, "restored");

      await vi.waitFor(() =>
        expect(harness.audit.map((row) => row.action)).toEqual([
          "governance.agent.stop_requested",
          "governance.agent.stop_approved",
          "governance.agent.quarantined",
          "governance.agent.restore_requested",
          "governance.agent.restored",
        ]),
      );
      expect(harness.audit.every((row) => row.targetId === AGENT_ID)).toBe(true);
      expect(harness.audit.every((row) => row.targetKind === "governance_agent")).toBe(true);

      const other = await killSwitchHarness();
      await other.setFullPlan();
      const denied = await request(other, MACHINE, "high");
      await settled(other, denied.id, "pending_approval");
      await other.stops.denyStop({ organizationId: ORG, stopId: denied.id, caller: PERSON });
      expect(other.audit.map((row) => row.action)).toContain("governance.agent.stop_denied");

      const service = await killSwitchHarness();
      await service.setFullPlan();
      await request(service, { userId: null, apiKeyId: "key-service" }, "high");
      expect(service.audit[0]).toMatchObject({
        action: "governance.agent.stop_requested",
        userId: "apikey:key-service",
      });
      await harness.eventing.close();
      await other.eventing.close();
      await service.eventing.close();
    });
  });
});

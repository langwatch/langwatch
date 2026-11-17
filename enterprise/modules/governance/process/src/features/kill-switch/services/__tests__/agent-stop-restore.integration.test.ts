/**
 * Restoring a stop and the audit trail of a stop's whole life, over memory.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { describe, expect, it, vi } from "vitest";

import { codeOf, request, settled } from "./kill-switch-steps.fixtures.ts";
import {
  AGENT_ID,
  killSwitchHarness,
  MACHINE,
  ORG,
  PERSON,
  VIRTUAL_KEY_ID,
} from "./kill-switch.fixtures.ts";

describe("AgentStopService restore", () => {
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

    /** @scenario "A second restore retries the reverts the first one could not do" */
    it("restores on a second try once the endpoint starts again", async () => {
      const { harness, stopId } = await partlyStopped({ refuseStart: true });
      await harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON });
      await settled(harness, stopId, "restore_failed");
      const startPath = "/api/2.0/serving-endpoints/support-bot-prod/config:start";
      harness.servingEndpoints.allow({ path: startPath });
      const startsBefore = harness.servingEndpoints.calls.filter(
        (call) => call.path === startPath,
      ).length;

      const second = await harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON });

      expect(second.status).toBe("restoring");
      const stop = await settled(harness, stopId, "restored");
      expect(stop.restoreRound).toBe(2);
      expect(harness.servingEndpoints.calls.filter((call) => call.path === startPath)).toHaveLength(
        startsBefore + 1,
      );
      await vi.waitFor(() =>
        expect(harness.announced.map((event) => event.milestone)).toEqual([
          "governance.agent.stop_failed",
          "governance.agent.restore_failed",
          "governance.agent.restored",
        ]),
      );
      const actions = harness.audit.map((row) => row.action);
      expect(
        actions.filter((action) => action === "governance.agent.restore_requested"),
      ).toHaveLength(2);
      expect(actions.filter((action) => action === "governance.agent.restore_failed")).toHaveLength(
        1,
      );
      expect(actions.filter((action) => action === "governance.agent.restored")).toHaveLength(1);
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

  describe("when a milestone announcement is delivered again", () => {
    /** @scenario "A redelivered milestone writes one audit row" */
    it("writes the quarantined row once", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness);
      await settled(harness, view.id, "quarantined");
      await vi.waitFor(() => expect(harness.announced).toHaveLength(1));
      const [announced] = harness.announced;
      if (!announced) throw new Error("no announcement");

      await harness.targets.announce({
        organizationId: ORG,
        milestone: announced.milestone,
        restoreRound: 0,
        stop: announced.stop,
      });

      expect(
        harness.audit.filter((row) => row.action === "governance.agent.quarantined"),
      ).toHaveLength(1);
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

  describe("given a quarantined stop with a Bedrock target", () => {
    /** @scenario "An AWS connection a stop plan or an unrestored stop still uses cannot be deleted" */
    it("refuses deleting the connection until the plan drops it and the stop is restored", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness);
      await settled(harness, view.id, "quarantined");
      const remove = () =>
        harness.connections.deleteConnection({
          organizationId: ORG,
          connectionId: harness.connection.id,
          userId: "user-ops",
        });
      await harness.plans.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: [] });

      expect(await codeOf(remove())).toBe("governance_aws_connection_in_use");

      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      const restored = await settled(harness, view.id, "restored");
      expect(restored.targets.every((target) => target.state === "reverted")).toBe(true);
      expect(await remove()).toEqual({ deleted: true });
      await harness.eventing.close();
    });
  });

  describe("when an ownerless API key restores a stop a person requested", () => {
    /** @scenario "A restore acts as the credential that asked for it" */
    it("enables the virtual key as the key's service principal", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, PERSON, "critical");
      await settled(harness, view.id, "quarantined");

      await harness.stops.restore({
        organizationId: ORG,
        stopId: view.id,
        caller: { userId: null, apiKeyId: "key-restore" },
      });
      await settled(harness, view.id, "restored");

      const enable = harness.virtualKeyCalls.find((call) => call.action === "enable");
      expect(enable?.input.actorUserId).toBe("svc_key-restore");
      await harness.eventing.close();
    });
  });

  describe("when an ownerless API key approves a stop a keyed person requested", () => {
    /** @scenario "A stop acts as the credential that decided it" */
    it("disables the virtual key as the approving key's service principal", async () => {
      const harness = await killSwitchHarness();
      await harness.setFullPlan();
      const view = await request(harness, MACHINE, "high");
      await settled(harness, view.id, "pending_approval");

      await harness.stops.approveStop({
        organizationId: ORG,
        stopId: view.id,
        caller: { userId: null, apiKeyId: "key-approver" },
      });
      await settled(harness, view.id, "quarantined");

      const disable = harness.virtualKeyCalls.find((call) => call.action === "disable");
      expect(disable?.input.actorUserId).toBe("svc_key-approver");
      await harness.eventing.close();
    });
  });
});

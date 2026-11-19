/**
 * Restoring a stop and the audit trail of a stop's whole life, over memory.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopTarget } from "@langwatch/enterprise-governance-contract";
import { parse } from "@langwatch/ksuid";
import { describe, expect, it, vi } from "vitest";

import {
  auditMomentOf,
  auditRowOf,
  codeOf,
  type Harness,
  request,
  settled,
} from "./kill-switch-steps.fixtures.ts";
import {
  AGENT_ID,
  killSwitchHarness,
  MACHINE,
  ORG,
  PERSON,
  VIRTUAL_KEY_ID,
  WORKSPACE,
  WORKSPACE_TOKEN,
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

    /** @scenario "A milestone audit row is stamped with the moment its milestone was reached" */
    it("stamps the restore_failed row with the moment its announcement says it failed", async () => {
      const { harness, stopId } = await partlyStopped({ refuseStart: true });
      const announce = vi.spyOn(harness.targets, "announce");

      await harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON });
      const stop = await settled(harness, stopId, "restore_failed");
      await vi.waitFor(() =>
        expect(harness.audit.map((row) => row.action)).toContain("governance.agent.restore_failed"),
      );

      const intent = announce.mock.calls
        .map(([call]) => call)
        .find((call) => call.milestone === "governance.agent.restore_failed");
      const row = harness.audit.find((entry) => entry.action === "governance.agent.restore_failed");
      const failedAt = (intent?.occurredAt ?? Number.NaN) + 1;
      expect(failedAt).toBeGreaterThan(Date.parse(stop.restoreRequestedAt ?? ""));
      expect(auditMomentOf(row)).toBe(failedAt);
      expect(parse(row?.idempotencyKey ?? "").date.getTime()).toBe(
        Math.floor(failedAt / 1000) * 1000,
      );
      const pushed = harness.announced.find(
        (event) => event.milestone === "governance.agent.restore_failed",
      );
      expect(pushed?.occurredAt).toBe(failedAt);
      await harness.eventing.close();
    });

    /** @scenario "A request and the milestone it causes list in causal order, even in one second" */
    it("dates the restored row after the restore request that caused it", async () => {
      const { harness, stopId } = await partlyStopped();

      await harness.stops.restore({ organizationId: ORG, stopId, caller: PERSON });
      const stop = await settled(harness, stopId, "restored");
      await vi.waitFor(() =>
        expect(auditRowOf(harness, "governance.agent.restored")).toBeDefined(),
      );

      const requested = auditRowOf(harness, "governance.agent.restore_requested");
      const restored = auditRowOf(harness, "governance.agent.restored");
      expect(auditMomentOf(requested)).toBe(Date.parse(stop.restoreRequestedAt ?? ""));
      expect(auditMomentOf(restored)).toBeGreaterThan(auditMomentOf(requested));
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

  describe("given two agents whose plans share one virtual key", () => {
    /** @scenario "Restoring one agent keeps a virtual key another stopped agent shares disabled" */
    it("keeps the key disabled until the last agent holding it is restored", async () => {
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

      await harness.stops.restore({ organizationId: ORG, stopId: first, caller: PERSON });
      const kept = await settled(harness, first, "restored");

      expect(kept.targets[0]).toMatchObject({ state: "reverted", keptDisabled: true });
      expect(harness.virtualKeyCalls.some((call) => call.action === "enable")).toBe(false);

      await harness.stops.restore({ organizationId: ORG, stopId: second, caller: PERSON });
      const last = await settled(harness, second, "restored");

      expect(last.targets[0]?.keptDisabled).toBeUndefined();
      expect(harness.virtualKeyCalls.filter((call) => call.action === "enable")).toHaveLength(1);
      await harness.eventing.close();
    });
  });

  describe("given two agents whose plans share one serving endpoint and one Bedrock alias", () => {
    /** @scenario "Restoring one agent keeps a serving endpoint and a Bedrock alias another stopped agent shares stopped" */
    it("keeps both stopped until the last agent holding them is restored", async () => {
      const other = "agent-sales-bot";
      const harness = await killSwitchHarness({ otherAgents: ["sales-bot"] });
      const twin = await harness.repositories.ingestionSources.create({
        organizationId: ORG,
        teamId: null,
        traceProjectId: null,
        sourceType: "databricks_genie",
        name: "Databricks (finance)",
        description: null,
        ingestSecretHash: "unused",
        parserConfig: {
          adapter: "databricks_genie",
          workspaceUrl: `${WORKSPACE}/`,
          credentials: { token: WORKSPACE_TOKEN },
        },
        pullSchedule: null,
        status: "awaiting_first_event",
        createdById: "user-ops",
        providerAccountId: null,
      });
      const [endpoint, alias] = harness.fullPlan.filter(
        (target) => target.kind !== "gateway_virtual_key",
      );
      if (endpoint?.kind !== "databricks_serving_endpoint" || !alias) throw new Error("no plan");
      const plans = {
        [AGENT_ID]: [endpoint, alias],
        [other]: [{ ...endpoint, ingestionSourceId: twin.id }, alias],
      };
      const stopIds: string[] = [];
      for (const [agentId, targets] of Object.entries(plans)) {
        await harness.plans.setPlan({ organizationId: ORG, agentId, targets });
        const view = await harness.stops.requestStop({
          organizationId: ORG,
          agentId,
          reason: "prompt injection in production",
          severity: "high",
          caller: PERSON,
        });
        stopIds.push(view.id);
        const stopped = await settled(harness, view.id, "quarantined");
        expect(stopped.targets.map((target) => target.alreadyStopped)).toEqual([
          undefined,
          undefined,
        ]);
      }
      const [first = "", second = ""] = stopIds;
      const startPath = "/api/2.0/serving-endpoints/support-bot-prod/config:start";
      const starts = () =>
        harness.servingEndpoints.calls.filter((call) => call.path === startPath).length;
      const aliasState = () =>
        harness.bedrock.getAlias({ agentId: "AGENT00001", agentAliasId: "ALIAS00001" })
          .aliasInvocationState;

      await harness.stops.restore({ organizationId: ORG, stopId: first, caller: PERSON });
      const kept = await settled(harness, first, "restored");

      expect(kept.targets.map((target) => target.keptDisabled)).toEqual([true, true]);
      expect(starts()).toBe(0);
      expect(aliasState()).toBe("REJECT_INVOCATIONS");

      await harness.stops.restore({ organizationId: ORG, stopId: second, caller: PERSON });
      const last = await settled(harness, second, "restored");

      expect(last.targets.map((target) => target.keptDisabled)).toEqual([undefined, undefined]);
      expect(starts()).toBe(1);
      expect(aliasState()).toBe("ACCEPT_INVOCATIONS");
      await harness.eventing.close();
    });
  });

  describe("given a shared virtual key and the other agent's stop waiting for approval", () => {
    async function sharedWithPendingStop() {
      const other = "agent-sales-bot";
      const harness = await killSwitchHarness({ otherAgents: ["sales-bot"] });
      for (const agentId of [AGENT_ID, other]) {
        await harness.plans.setPlan({
          organizationId: ORG,
          agentId,
          targets: [{ kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID }],
        });
      }
      const first = await harness.stops.requestStop({
        organizationId: ORG,
        agentId: AGENT_ID,
        reason: "prompt injection in production",
        severity: "high",
        caller: PERSON,
      });
      await settled(harness, first.id, "quarantined");
      const second = await harness.stops.requestStop({
        organizationId: ORG,
        agentId: other,
        reason: "prompt injection in production",
        severity: "high",
        caller: MACHINE,
      });
      await settled(harness, second.id, "pending_approval");
      await harness.stops.restore({ organizationId: ORG, stopId: first.id, caller: PERSON });
      const restored = await settled(harness, first.id, "restored");
      return { harness, restored, secondId: second.id };
    }

    /** @scenario "A stop waiting for approval does not keep a shared virtual key disabled" */
    it("enables the key on restore, and a denial leaves it enabled", async () => {
      const { harness, restored, secondId } = await sharedWithPendingStop();

      expect(restored.targets[0]?.keptDisabled).toBeUndefined();
      await harness.stops.denyStop({ organizationId: ORG, stopId: secondId, caller: PERSON });
      await settled(harness, secondId, "denied");

      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect(harness.virtualKeyCalls.map((call) => call.action)).toEqual(["disable", "enable"]);
      await harness.eventing.close();
    });

    /** @scenario "A stop waiting for approval does not keep a shared virtual key disabled" */
    it("disables the key again on approval and enables it on that stop's restore", async () => {
      const { harness, secondId } = await sharedWithPendingStop();

      await harness.stops.approveStop({ organizationId: ORG, stopId: secondId, caller: PERSON });
      const approved = await settled(harness, secondId, "quarantined");
      expect(approved.targets[0]?.alreadyStopped).toBeUndefined();
      await harness.stops.restore({ organizationId: ORG, stopId: secondId, caller: PERSON });
      await settled(harness, secondId, "restored");

      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      expect(harness.virtualKeyCalls.map((call) => call.action)).toEqual([
        "disable",
        "enable",
        "disable",
        "enable",
      ]);
      await harness.eventing.close();
    });
  });

  describe("given a shared key a restore kept disabled for a stop that later let it go", () => {
    /** @scenario "A stop that finds a shared key left disabled by a closed stop owns it" */
    it("takes the key over, so its restore enables it", async () => {
      const other = "agent-sales-bot";
      const harness = await killSwitchHarness({ otherAgents: ["sales-bot"] });
      const keyOnly = [{ kind: "gateway_virtual_key" as const, virtualKeyId: VIRTUAL_KEY_ID }];
      const stopIds: string[] = [];
      for (const agentId of [AGENT_ID, other]) {
        await harness.plans.setPlan({ organizationId: ORG, agentId, targets: keyOnly });
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
      await harness.stops.restore({ organizationId: ORG, stopId: first, caller: PERSON });
      const kept = await settled(harness, first, "restored");
      expect(kept.targets[0]?.keptDisabled).toBe(true);
      await harness.stops.setPlan({
        organizationId: ORG,
        agentId: other,
        targets: [],
        caller: PERSON,
      });
      await vi.waitFor(async () => expect((await harness.stopOf(second)).targets).toEqual([]));

      const again = await harness.stops.requestStop({
        organizationId: ORG,
        agentId: AGENT_ID,
        reason: "prompt injection in production",
        severity: "high",
        caller: PERSON,
      });
      const owned = await settled(harness, again.id, "quarantined");
      expect(owned.targets[0]?.alreadyStopped).toBeUndefined();
      await harness.stops.restore({ organizationId: ORG, stopId: again.id, caller: PERSON });
      await settled(harness, again.id, "restored");

      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      await harness.eventing.close();
    });
  });

  describe("given a shared target off while another stop's restore of it failed", () => {
    const reason = "prompt injection in production";
    async function stopAgent(harness: Harness, agentId: string, targets: AgentStopTarget[]) {
      await harness.plans.setPlan({ organizationId: ORG, agentId, targets });
      const view = await harness.stops.requestStop({
        organizationId: ORG,
        agentId,
        reason,
        severity: "high",
        caller: PERSON,
      });
      return settled(harness, view.id, "quarantined");
    }

    /** @scenario "A stop that finds a shared target off while another stop is letting it go owns it" */
    it("records a Bedrock alias as the new stop's own, so the failed stop's next restore keeps it off", async () => {
      const harness = await killSwitchHarness({ otherAgents: ["sales-bot", "ops-bot"] });
      const alias = harness.fullPlan.filter((target) => target.kind === "bedrock_agent_alias");
      const aliasState = () =>
        harness.bedrock.getAlias({ agentId: "AGENT00001", agentAliasId: "ALIAS00001" })
          .aliasInvocationState;
      const first = await stopAgent(harness, AGENT_ID, alias);
      const second = await stopAgent(harness, "agent-sales-bot", alias);
      await harness.stops.restore({ organizationId: ORG, stopId: first.id, caller: PERSON });
      expect((await settled(harness, first.id, "restored")).targets[0]?.keptDisabled).toBe(true);
      harness.bedrock.refuseWith("ThrottlingException");
      await harness.stops.restore({ organizationId: ORG, stopId: second.id, caller: PERSON });
      await settled(harness, second.id, "restore_failed");
      harness.bedrock.refuseWith(null);

      const third = await stopAgent(harness, "agent-ops-bot", alias);
      expect(third.targets[0]?.alreadyStopped).toBeUndefined();
      await harness.stops.restore({ organizationId: ORG, stopId: second.id, caller: PERSON });
      const released = await settled(harness, second.id, "restored");

      expect(released.targets[0]?.keptDisabled).toBe(true);
      expect(aliasState()).toBe("REJECT_INVOCATIONS");
      await harness.stops.restore({ organizationId: ORG, stopId: third.id, caller: PERSON });
      await settled(harness, third.id, "restored");
      expect(aliasState()).toBe("ACCEPT_INVOCATIONS");
      await harness.eventing.close();
    });

    /** @scenario "A stop that finds a shared target off while another stop is letting it go owns it" */
    it("records a virtual key as the new stop's own when its only holder's restore failed", async () => {
      const harness = await killSwitchHarness({ otherAgents: ["sales-bot"] });
      const key = [{ kind: "gateway_virtual_key" as const, virtualKeyId: VIRTUAL_KEY_ID }];
      const first = await stopAgent(harness, AGENT_ID, key);
      harness.keyRefusals.set("enable", "gateway_unavailable");
      await harness.stops.restore({ organizationId: ORG, stopId: first.id, caller: PERSON });
      await settled(harness, first.id, "restore_failed");
      harness.keyRefusals.delete("enable");

      const second = await stopAgent(harness, "agent-sales-bot", key);
      expect(second.targets[0]?.alreadyStopped).toBeUndefined();
      await harness.stops.restore({ organizationId: ORG, stopId: first.id, caller: PERSON });
      const released = await settled(harness, first.id, "restored");

      expect(released.targets[0]?.keptDisabled).toBe(true);
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("DISABLED");
      await harness.stops.restore({ organizationId: ORG, stopId: second.id, caller: PERSON });
      await settled(harness, second.id, "restored");
      expect(harness.keyStatuses.get(VIRTUAL_KEY_ID)).toBe("ACTIVE");
      await harness.eventing.close();
    });
  });

  describe("when the serving endpoint was deleted after the stop", () => {
    /** @scenario "A target whose cloud resource was deleted after the stop counts as restored" */
    it("restores the stop, recording the endpoint as gone", async () => {
      const harness = await killSwitchHarness({ maxAttempts: 2 });
      await harness.setFullPlan();
      const view = await request(harness);
      await settled(harness, view.id, "quarantined");
      harness.servingEndpoints.refuse({
        path: "/api/2.0/serving-endpoints/support-bot-prod/config:start",
        code: "http_404",
      });

      await harness.stops.restore({ organizationId: ORG, stopId: view.id, caller: PERSON });
      const restored = await settled(harness, view.id, "restored");

      expect(
        restored.targets.find((target) => target.target.kind === "databricks_serving_endpoint"),
      ).toMatchObject({ state: "reverted", gone: true });
      await vi.waitFor(() =>
        expect(harness.audit.map((row) => row.action)).toContain("governance.agent.restored"),
      );
      const audited = harness.audit.find((row) => row.action === "governance.agent.restored");
      expect(JSON.stringify(audited?.metadata)).toContain('"gone":true');
      await harness.eventing.close();
    });
  });

  describe("when the platforms do not find a target on the stop's first call", () => {
    /** @scenario "A target its platform does not find on the stop's first call fails as target_not_found" */
    it("records the endpoint and the alias failed with target_not_found, never as gone", async () => {
      const harness = await killSwitchHarness({ maxAttempts: 2 });
      await harness.setFullPlan();
      harness.servingEndpoints.refuse({
        path: "/api/2.0/serving-endpoints/support-bot-prod/config:stop",
        code: "http_404",
      });
      harness.bedrock.refuseWith("ResourceNotFoundException");

      const view = await request(harness);
      const failed = await settled(harness, view.id, "stop_failed");

      const byKind = (kind: string) => failed.targets.find((target) => target.target.kind === kind);
      for (const kind of ["databricks_serving_endpoint", "bedrock_agent_alias"]) {
        expect(byKind(kind)).toMatchObject({ state: "failed", errorCode: "target_not_found" });
        expect(byKind(kind)?.gone).toBeUndefined();
      }
      expect(byKind("gateway_virtual_key")?.state).toBe("applied");
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
        retryRound: 0,
        occurredAt: announced.occurredAt,
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

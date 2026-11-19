/**
 * A plan change dropping targets from an open stop: applied ones are reverted before they leave, an
 * apply in flight is reverted once it lands, and a stop left with nothing closes as restored.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopPlanTarget } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  type AgentStopRecord,
  approvedStop,
  isRevertSuperseded,
  requestedStop,
  restoreRequestedStop,
  targetAppliedStop,
  targetFailedStop,
  targetRevertedStop,
  targetRevertFailedStop,
  targetsDroppedStop,
} from "../agent-stop.rules.ts";

const STOP_ID = "stop-1";
const ORG = "org-acme";
const KEY: AgentStopPlanTarget = {
  id: "target-key",
  label: "Virtual key",
  target: { kind: "gateway_virtual_key", virtualKeyId: "vk-1" },
};
const ALIAS: AgentStopPlanTarget = {
  id: "target-alias",
  label: "Bedrock alias",
  target: {
    kind: "bedrock_agent_alias",
    awsConnectionId: "conn-1",
    region: "eu-west-1",
    agentId: "AGENT00001",
    agentAliasId: "ALIAS00001",
  },
};

function requested({
  targets,
  approval = "immediate",
}: {
  targets: AgentStopPlanTarget[];
  approval?: "immediate" | "required";
}): AgentStopRecord {
  return requestedStop({
    data: {
      stopId: STOP_ID,
      organizationId: ORG,
      agentId: "agent-1",
      agentName: "support-bot",
      severity: "high",
      approval,
      trigger: approval === "immediate" ? "user" : "api_key",
      reason: "prompt injection in production",
      requestedByUserId: "user-ops",
      requestedByApiKeyId: approval === "immediate" ? null : "key-1",
      targets,
    },
    at: 1_000,
  });
}

const outcome = (targetId: string) => ({ stopId: STOP_ID, organizationId: ORG, targetId });

function applied(stop: AgentStopRecord, targetId: string, at = 2_000): AgentStopRecord {
  return targetAppliedStop({ stop, data: { ...outcome(targetId), errorCode: null }, at });
}

function drop(stop: AgentStopRecord, targetIds: string[], dropId = "drop-1"): AgentStopRecord {
  return targetsDroppedStop({
    stop,
    data: { stopId: STOP_ID, organizationId: ORG, targetIds, dropId },
    at: 3_000,
  });
}

describe("targetsDroppedStop", () => {
  describe("given a quarantined stop", () => {
    /** @scenario "A target the stop changed is reverted when the plan drops it" */
    it("reverts the dropped key, keeps the stop quarantined, and lets the key go once reverted", () => {
      const quarantined = applied(applied(requested({ targets: [KEY, ALIAS] }), KEY.id), ALIAS.id);

      const dropped = drop(quarantined, [KEY.id]);
      const reverted = targetRevertedStop({
        stop: dropped,
        data: { ...outcome(KEY.id), errorCode: null, dropId: "drop-1" },
        at: 4_000,
      });

      expect(dropped.status).toBe("quarantined");
      expect(dropped.targets.find((target) => target.id === KEY.id)).toMatchObject({
        state: "reverting",
        dropped: true,
        dropId: "drop-1",
      });
      expect(reverted.status).toBe("quarantined");
      expect(reverted.targets.map((target) => target.id)).toEqual([ALIAS.id]);
    });

    it("keeps a dropped key whose revert failed on the stop, and the next drop retries it", () => {
      const quarantined = applied(requested({ targets: [KEY, ALIAS] }), KEY.id);
      const both = applied(quarantined, ALIAS.id);
      const failed = targetRevertFailedStop({
        stop: drop(both, [KEY.id]),
        data: { ...outcome(KEY.id), errorCode: "http_503", dropId: "drop-1" },
        at: 4_000,
      });

      const again = drop(failed, [KEY.id], "drop-2");

      expect(failed.targets.find((target) => target.id === KEY.id)).toMatchObject({
        state: "revert_failed",
        errorCode: "http_503",
      });
      expect(again.targets.find((target) => target.id === KEY.id)).toMatchObject({
        state: "reverting",
        dropId: "drop-2",
      });
    });

    /** @scenario "A stop whose plan lost every target closes as restored" */
    it("restores the stop once every target it held was dropped and reverted", () => {
      const quarantined = applied(requested({ targets: [KEY] }), KEY.id);

      const dropped = drop(quarantined, [KEY.id]);
      const reverted = targetRevertedStop({
        stop: dropped,
        data: { ...outcome(KEY.id), errorCode: null, dropId: "drop-1" },
        at: 4_000,
      });

      expect(dropped.status).toBe("quarantined");
      expect(reverted).toMatchObject({ status: "restored", targets: [] });
      expect(reverted.restoredAt).not.toBeNull();
    });
  });

  describe("given a stop whose apply is in flight", () => {
    /** @scenario "An apply in flight for a dropped target is reverted once it lands" */
    it("reverts the target once its apply lands instead of throwing the result away", () => {
      const stopping = requested({ targets: [KEY, ALIAS] });

      const dropped = drop(stopping, [KEY.id]);
      const quarantined = applied(dropped, ALIAS.id);
      const landed = applied(quarantined, KEY.id, 4_000);

      expect(dropped.targets.find((target) => target.id === KEY.id)).toMatchObject({
        state: "pending",
        dropped: true,
      });
      expect(quarantined.status).toBe("quarantined");
      expect(landed.status).toBe("quarantined");
      expect(landed.targets.find((target) => target.id === KEY.id)).toMatchObject({
        state: "reverting",
        dropId: "drop-1",
      });
    });

    it("lets the target go at once when its apply found it already stopped or never ran", () => {
      const dropped = drop(requested({ targets: [KEY, ALIAS] }), [KEY.id, ALIAS.id]);

      const alreadyStopped = targetAppliedStop({
        stop: dropped,
        data: { ...outcome(KEY.id), errorCode: null, alreadyStopped: true },
        at: 4_000,
      });
      const neverRan = targetFailedStop({
        stop: alreadyStopped,
        data: { ...outcome(ALIAS.id), errorCode: "target_not_in_plan" },
        at: 4_000,
      });

      expect(alreadyStopped.status).toBe("stopping");
      expect(neverRan).toMatchObject({ status: "restored", targets: [] });
    });
  });

  describe("given a stop waiting for an approval", () => {
    /** @scenario "A stop whose plan lost every target closes as restored" */
    it("closes as restored at once when the plan drops every pending target", () => {
      const pending = requested({ targets: [KEY], approval: "required" });

      const dropped = drop(pending, [KEY.id]);
      const approved = approvedStop({
        stop: dropped,
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          decidedByUserId: "user-oncall",
          decidedByApiKeyId: null,
          note: null,
        },
        at: 4_000,
      });

      expect(dropped).toMatchObject({ status: "restored", targets: [] });
      expect(dropped.restoredAt).not.toBeNull();
      expect(dropped.quarantinedAt).toBeNull();
      expect(approved).toBe(dropped);
    });

    it("keeps waiting for its approval while the plan still holds a target", () => {
      const pending = requested({ targets: [KEY, ALIAS], approval: "required" });

      const dropped = drop(pending, [KEY.id]);

      expect(dropped.status).toBe("pending_approval");
      expect(dropped.targets.map((target) => target.id)).toEqual([ALIAS.id]);
    });
  });

  describe("given a stop restoring a dropped target the drop is already reverting", () => {
    it("lets the drop's revert settle the restore", () => {
      const quarantined = applied(applied(requested({ targets: [KEY, ALIAS] }), KEY.id), ALIAS.id);
      const dropped = drop(quarantined, [KEY.id]);
      const restoring = restoreRequestedStop({
        stop: dropped,
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          requestId: "restore-1",
        },
        at: 4_000,
      });

      const aliasReverted = targetRevertedStop({
        stop: restoring,
        data: { ...outcome(ALIAS.id), errorCode: null, restoreRound: 1 },
        at: 5_000,
      });
      const keyReverted = targetRevertedStop({
        stop: aliasReverted,
        data: { ...outcome(KEY.id), errorCode: null, dropId: "drop-1" },
        at: 6_000,
      });

      expect(restoring.lastRequestId).toBe("restore-1");
      expect(aliasReverted.status).toBe("restoring");
      expect(keyReverted.status).toBe("restored");
      expect(keyReverted.targets.map((target) => target.id)).toEqual([ALIAS.id]);
    });

    /** @scenario "A restore asked while a drop's revert is redelivered still settles that revert" */
    it("keeps the drop's revert live after the restore round advanced", () => {
      const quarantined = applied(applied(requested({ targets: [KEY, ALIAS] }), KEY.id), ALIAS.id);
      const restoring = restoreRequestedStop({
        stop: drop(quarantined, [KEY.id]),
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          requestId: "restore-1",
        },
        at: 4_000,
      });
      const dropRevert = { stop: restoring, targetId: KEY.id, restoreRound: 0 };

      expect(restoring.restoreRound).toBe(1);
      expect(isRevertSuperseded({ ...dropRevert, dropId: "drop-1" })).toBe(false);
      expect(isRevertSuperseded({ ...dropRevert, dropId: "drop-0" })).toBe(true);
      expect(isRevertSuperseded({ ...dropRevert, dropId: undefined })).toBe(true);
    });

    it("leaves a drop's revert to the restore round once that restore took the target over", () => {
      const quarantined = applied(applied(requested({ targets: [KEY, ALIAS] }), KEY.id), ALIAS.id);
      const failed = targetRevertFailedStop({
        stop: drop(quarantined, [KEY.id]),
        data: { ...outcome(KEY.id), errorCode: "provider_unavailable", dropId: "drop-1" },
        at: 3_500,
      });
      const restoring = restoreRequestedStop({
        stop: failed,
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          requestId: "restore-1",
        },
        at: 4_000,
      });

      expect(
        isRevertSuperseded({
          stop: restoring,
          targetId: KEY.id,
          restoreRound: 0,
          dropId: "drop-1",
        }),
      ).toBe(true);
    });
  });
});

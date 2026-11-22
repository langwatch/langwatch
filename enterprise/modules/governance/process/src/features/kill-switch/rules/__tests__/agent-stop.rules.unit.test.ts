/**
 * The stop fold across two restores: each restore is a round, and an outcome answers only its own.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { AGENT_STOP_EVENT_TYPES } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { foldAgentStop } from "../../eventing/agent-stop.projection.ts";
import {
  milestoneAuditKeyOf,
  milestoneMomentOf,
} from "../../services/agent-stop-target.service.ts";
import { isGoneErrorCode } from "../agent-stop-target.rules.ts";
import {
  advancedStop,
  requestedStop,
  restoreRequestedStop,
  retriedStop,
  targetAppliedStop,
  targetFailedStop,
  targetRevertedStop,
  targetRevertFailedStop,
  targetsDroppedStop,
  viewOfStop,
} from "../agent-stop.rules.ts";

const STOP_ID = "stop-1";
const ORG = "org-acme";
const TARGET_ID = "target-key";

function restoreFailedStop() {
  const requested = requestedStop({
    data: {
      stopId: STOP_ID,
      organizationId: ORG,
      agentId: "agent-1",
      agentName: "support-bot",
      severity: "high",
      approval: "immediate",
      trigger: "user",
      reason: "prompt injection in production",
      requestedByUserId: "user-ops",
      requestedByApiKeyId: null,
      targets: [
        {
          id: TARGET_ID,
          label: "Virtual key",
          target: { kind: "gateway_virtual_key", virtualKeyId: "vk-1" },
        },
      ],
    },
    at: 1_000,
  });
  const settledOutcome = { stopId: STOP_ID, organizationId: ORG, targetId: TARGET_ID };
  const quarantined = targetAppliedStop({
    stop: requested,
    data: { ...settledOutcome, errorCode: null },
    at: 2_000,
  });
  const restore = (stop: typeof quarantined, restoreRound: number, at: number) =>
    restoreRequestedStop({
      stop,
      data: {
        stopId: STOP_ID,
        organizationId: ORG,
        requestedByUserId: "user-ops",
        requestedByApiKeyId: null,
        requestId: `restore-${restoreRound}`,
      },
      at,
    });
  const failed = targetRevertFailedStop({
    stop: restore(quarantined, 1, 3_000),
    data: { ...settledOutcome, errorCode: "http_503", restoreRound: 1 },
    at: 4_000,
  });
  return { failed, restore, settledOutcome };
}

describe("restoreRequestedStop", () => {
  describe("given a stop whose first restore failed", () => {
    it("starts round 2 and puts the failed revert back to reverting", () => {
      const { failed, restore } = restoreFailedStop();
      expect(failed.status).toBe("restore_failed");

      const second = restore(failed, 2, 5_000);

      expect(second.status).toBe("restoring");
      expect(second.restoreRound).toBe(2);
      expect(second.targets[0]).toMatchObject({ state: "reverting", errorCode: null });
    });
  });
});

describe("targetRevertFailedStop", () => {
  describe("when an outcome of the first restore arrives during the second", () => {
    /** @scenario "A late outcome of an earlier restore changes nothing" */
    it("drops it, and the second round's own outcome settles the stop", () => {
      const { failed, restore, settledOutcome } = restoreFailedStop();
      const second = restore(failed, 2, 5_000);

      const late = targetRevertFailedStop({
        stop: second,
        data: { ...settledOutcome, errorCode: "http_503", restoreRound: 1 },
        at: 6_000,
      });
      const reverted = targetRevertedStop({
        stop: late,
        data: { ...settledOutcome, errorCode: null, restoreRound: 2 },
        at: 7_000,
      });

      expect(late).toEqual(second);
      expect(reverted.status).toBe("restored");
    });
  });
});

describe("milestoneAuditKeyOf", () => {
  describe("when the same milestone of the same round is announced twice", () => {
    it("answers one key, and another round answers another", () => {
      const { failed } = restoreFailedStop();
      const stop = viewOfStop(failed);
      const milestone = "governance.agent.restore_failed" as const;

      const at = milestoneMomentOf({ stop });
      const first = milestoneAuditKeyOf({ stop, milestone, restoreRound: 1, at });

      expect(milestoneAuditKeyOf({ stop, milestone, restoreRound: 1, at })).toBe(first);
      expect(milestoneAuditKeyOf({ stop, milestone, restoreRound: 2, at })).not.toBe(first);
    });
  });
});

describe("isGoneErrorCode", () => {
  it("reads a Databricks 404 and a Bedrock ResourceNotFoundException as gone, a 503 not", () => {
    expect(isGoneErrorCode("http_404")).toBe(true);
    expect(isGoneErrorCode("ResourceNotFoundException")).toBe(true);
    expect(isGoneErrorCode("http_503")).toBe(false);
  });
});

describe("retriedStop", () => {
  describe("given a stop whose restore failed", () => {
    it("stops the target whose revert failed again, since the revert may have taken effect", () => {
      const { failed } = restoreFailedStop();

      const retried = retriedStop({
        stop: failed,
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          requestedByUserId: "user-oncall",
          requestedByApiKeyId: null,
          requestId: "retry-1",
          targets: [],
        },
        at: 5_000,
      });

      expect(retried).toMatchObject({
        status: "stopping",
        retryRound: 1,
        retriedByUserId: "user-oncall",
      });
      expect(retried.targets[0]).toMatchObject({ state: "pending", errorCode: null });
    });
  });

  describe("given a stop whose target failed", () => {
    /** @scenario "A late outcome of an earlier run changes nothing after a retry" */
    it("puts the target back to pending and ignores an outcome of the first run", () => {
      const { settledOutcome } = restoreFailedStop();
      const requested = requestedStop({
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          agentId: "agent-1",
          agentName: "support-bot",
          severity: "high",
          approval: "immediate",
          trigger: "user",
          reason: "r",
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          targets: [
            {
              id: TARGET_ID,
              label: "Virtual key",
              target: { kind: "gateway_virtual_key", virtualKeyId: "vk-1" },
            },
          ],
        },
        at: 1_000,
      });
      const failed = targetFailedStop({
        stop: requested,
        data: { ...settledOutcome, errorCode: "http_503" },
        at: 2_000,
      });
      const retried = retriedStop({
        stop: failed,
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          requestId: "retry-1",
          targets: [],
        },
        at: 3_000,
      });

      const late = targetAppliedStop({
        stop: retried,
        data: { ...settledOutcome, errorCode: null },
        at: 4_000,
      });
      const applied = targetAppliedStop({
        stop: retried,
        data: { ...settledOutcome, errorCode: null, retryRound: 1 },
        at: 4_000,
      });

      expect(failed.status).toBe("stop_failed");
      expect(retried).toMatchObject({ status: "stopping", targets: [{ state: "pending" }] });
      expect(late).toEqual(retried);
      expect(applied.status).toBe("quarantined");
    });
  });
});

describe("targetsDroppedStop", () => {
  describe("given a stop whose restore failed on its only target", () => {
    it("reverts that target again, and restores the stop once the revert lands", () => {
      const { failed, settledOutcome } = restoreFailedStop();

      const dropped = targetsDroppedStop({
        stop: failed,
        data: { stopId: STOP_ID, organizationId: ORG, targetIds: [TARGET_ID], dropId: "drop-1" },
        at: 5_000,
      });
      const reverted = targetRevertedStop({
        stop: dropped,
        data: { ...settledOutcome, errorCode: null, dropId: "drop-1" },
        at: 6_000,
      });

      expect(dropped.status).toBe("restoring");
      expect(dropped.targets[0]).toMatchObject({ state: "reverting", dropped: true });
      expect(reverted).toMatchObject({ status: "restored", targets: [] });
    });
  });
  describe("when a restore arrives while the stop is still stopping", () => {
    /** @scenario "A restore that races a retry is refused by the stop and the next restore reverts" */
    it("leaves the round unchanged, and numbers the next accepted restore 1", () => {
      const target = {
        id: TARGET_ID,
        label: "Virtual key",
        target: { kind: "gateway_virtual_key" as const, virtualKeyId: "vk-1" },
      };
      const stopping = requestedStop({
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          agentId: "agent-1",
          agentName: "support-bot",
          severity: "high",
          approval: "immediate",
          trigger: "user",
          reason: "prompt injection in production",
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          targets: [target],
        },
        at: 1_000,
      });
      const ask = (requestId: string) => ({
        stopId: STOP_ID,
        organizationId: ORG,
        requestedByUserId: "user-ops",
        requestedByApiKeyId: null,
        requestId,
      });

      const refused = restoreRequestedStop({ stop: stopping, data: ask("r-1"), at: 1_500 });
      expect(refused).toBe(stopping);
      const quarantined = targetAppliedStop({
        stop: refused,
        data: { stopId: STOP_ID, organizationId: ORG, targetId: TARGET_ID, errorCode: null },
        at: 2_000,
      });
      const restoring = restoreRequestedStop({ stop: quarantined, data: ask("r-2"), at: 3_000 });

      expect(restoring).toMatchObject({ status: "restoring", restoreRound: 1 });
      expect(restoring.targets[0]?.state).toBe("reverting");
    });
  });
});

describe("foldAgentStop", () => {
  describe("when the API already advanced the row by a request", () => {
    const { failed } = restoreFailedStop();
    const requests = [
      {
        type: AGENT_STOP_EVENT_TYPES.RETRY_REQUESTED,
        requestId: "retry-1",
        data: {
          stopId: STOP_ID,
          organizationId: ORG,
          requestedByUserId: "user-ops",
          requestedByApiKeyId: null,
          requestId: "retry-1",
          targets: [],
        },
      },
      {
        type: AGENT_STOP_EVENT_TYPES.TARGETS_DROPPED,
        requestId: "drop-1",
        data: { stopId: STOP_ID, organizationId: ORG, targetIds: [TARGET_ID], dropId: "drop-1" },
      },
    ];

    /** @scenario "A retry with nothing new to apply is counted once, however far the worker lags" */
    it.each(requests)("folds the $type event as a no-op that lets go of it", (request) => {
      const decided = foldAgentStop({
        stop: failed,
        type: request.type,
        data: request.data,
        at: 5_000,
      });
      if (!decided) throw new Error("the fold dropped the stop");
      const row = advancedStop({ stop: decided, requestId: request.requestId });

      const folded = foldAgentStop({
        stop: row,
        type: request.type,
        data: request.data,
        at: 6_000,
      });

      expect(decided).not.toEqual(failed);
      expect(folded).toEqual(decided);
    });
  });
});

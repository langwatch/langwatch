/**
 * The stop fold across two restores: each restore is a round, and an outcome answers only its own.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { describe, expect, it } from "vitest";

import { milestoneAuditKeyOf } from "../../services/agent-stop-target.service.ts";
import {
  requestedStop,
  restoreRequestedStop,
  targetAppliedStop,
  targetRevertedStop,
  targetRevertFailedStop,
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
        restoreRound,
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

      const first = milestoneAuditKeyOf({ stop, milestone, restoreRound: 1 });

      expect(milestoneAuditKeyOf({ stop, milestone, restoreRound: 1 })).toBe(first);
      expect(milestoneAuditKeyOf({ stop, milestone, restoreRound: 2 })).not.toBe(first);
    });
  });
});

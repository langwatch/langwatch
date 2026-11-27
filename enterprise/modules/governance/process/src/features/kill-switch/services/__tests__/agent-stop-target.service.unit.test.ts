/**
 * The audit key and webhook moment of an announced milestone: one row per milestone and round,
 * stamped with the moment the milestone was reached, after the request that caused it.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { parse } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { milestoneAuditKeyOf, milestoneMomentOf } from "../agent-stop-target.service.ts";

const STOP: AgentStopView = {
  id: "agentstop_1",
  agentId: "agent-support-bot",
  agentName: "support-bot",
  status: "restore_failed",
  severity: "high",
  approval: "immediate",
  trigger: "user",
  reason: "prompt injection in production",
  requestedBy: { userId: "user-ops", apiKeyId: null },
  decidedByUserId: null,
  restoredByUserId: "user-ops",
  targets: [],
  requestedAt: "2026-11-19T18:43:39.000Z",
  decidedAt: null,
  quarantinedAt: "2026-11-19T18:43:39.500Z",
  restoreRequestedAt: "2026-11-19T18:43:40.000Z",
  restoredAt: null,
};

const RESTORE_FAILED = {
  stop: STOP,
  milestone: "governance.agent.restore_failed",
  restoreRound: 1,
} as const;

describe("milestoneAuditKeyOf", () => {
  describe("given a restore asked at one moment that failed fifteen seconds later", () => {
    /** @scenario "A milestone audit row is stamped with the moment its milestone was reached" */
    it("keys the row in the second the restore failed, and names it again on redelivery", () => {
      const at = milestoneMomentOf({
        stop: STOP,
        occurredAt: Date.parse("2026-11-19T18:43:55.400Z"),
      });

      const key = milestoneAuditKeyOf({ ...RESTORE_FAILED, at });
      const redelivered = milestoneAuditKeyOf({ ...RESTORE_FAILED, at });

      expect(parse(key).date.toISOString()).toBe("2026-11-19T18:43:55.000Z");
      expect(redelivered).toBe(key);
    });
  });
});

describe("milestoneMomentOf", () => {
  describe("given an announcement that carries its moment", () => {
    /** @scenario "A milestone audit row is stamped with the moment its milestone was reached" */
    it("stamps that moment to the millisecond, inside the second its audit key holds", () => {
      const failedAt = Date.parse("2026-11-19T18:43:55.400Z");

      const at = milestoneMomentOf({ stop: STOP, occurredAt: failedAt });

      expect(at).toBe(failedAt + 1);
      const key = milestoneAuditKeyOf({ ...RESTORE_FAILED, at });
      expect(parse(key).date.getTime()).toBe(Math.floor(at / 1000) * 1000);
    });
  });

  describe("given a milestone reached in the same millisecond as the request that caused it", () => {
    /** @scenario "A request and the milestone it causes list in causal order, even in one second" */
    it("stamps the milestone one millisecond after the request, so the request lists first", () => {
      const asked = Date.parse(STOP.restoreRequestedAt ?? "");

      expect(milestoneMomentOf({ stop: STOP, occurredAt: asked })).toBe(asked + 1);
    });

    /** @scenario "A request and the milestone it causes list in causal order, even in one second" */
    it("stays after the request when the worker's clock reads earlier than the request's", () => {
      const asked = Date.parse(STOP.restoreRequestedAt ?? "");

      expect(milestoneMomentOf({ stop: STOP, occurredAt: asked - 40 })).toBe(asked + 1);
    });
  });

  describe("given an announcement queued without its moment", () => {
    it("falls back to the stop's latest recorded moment, the same on every redelivery", () => {
      expect(milestoneMomentOf({ stop: STOP })).toBe(Date.parse("2026-11-19T18:43:40.001Z"));
    });

    it("keeps the milliseconds of a latest moment that has them", () => {
      const stop = { ...STOP, restoreRequestedAt: null, restoredAt: null };

      expect(milestoneMomentOf({ stop })).toBe(Date.parse("2026-11-19T18:43:39.501Z"));
    });
  });
});

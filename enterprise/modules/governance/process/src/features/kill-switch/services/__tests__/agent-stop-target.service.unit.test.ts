/**
 * The audit key and webhook moment of an announced milestone: one row per milestone and round,
 * stamped with the moment the milestone was reached.
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
    it("stamps the row with the moment the restore failed, and names it again on redelivery", () => {
      const failedAt = Date.parse("2026-11-19T18:43:55.400Z");

      const key = milestoneAuditKeyOf({ ...RESTORE_FAILED, occurredAt: failedAt });
      const redelivered = milestoneAuditKeyOf({ ...RESTORE_FAILED, occurredAt: failedAt });

      expect(parse(key).date.toISOString()).toBe("2026-11-19T18:43:55.000Z");
      expect(redelivered).toBe(key);
    });

    it("keeps the stop's latest moment for an announcement queued without its moment", () => {
      const key = milestoneAuditKeyOf(RESTORE_FAILED);

      expect(parse(key).date.toISOString()).toBe("2026-11-19T18:43:40.000Z");
    });
  });
});

describe("milestoneMomentOf", () => {
  describe("given an announcement that carries its moment", () => {
    /** @scenario "A milestone audit row is stamped with the moment its milestone was reached" */
    it("stamps that moment in whole seconds, the moment the audit key holds", () => {
      const failedAt = Date.parse("2026-11-19T18:43:55.400Z");

      const at = milestoneMomentOf({ stop: STOP, occurredAt: failedAt });

      expect(at).toBe(Date.parse("2026-11-19T18:43:55.000Z"));
      const key = milestoneAuditKeyOf({ ...RESTORE_FAILED, occurredAt: failedAt });
      expect(parse(key).date.getTime()).toBe(at);
    });
  });

  describe("given an announcement queued without its moment", () => {
    it("falls back to the stop's latest recorded moment, the same on every redelivery", () => {
      expect(milestoneMomentOf({ stop: STOP })).toBe(Date.parse("2026-11-19T18:43:40.000Z"));
    });

    it("floors a latest moment with milliseconds to its second", () => {
      const stop = { ...STOP, restoreRequestedAt: null, restoredAt: null };

      expect(milestoneMomentOf({ stop })).toBe(Date.parse("2026-11-19T18:43:39.000Z"));
    });
  });
});

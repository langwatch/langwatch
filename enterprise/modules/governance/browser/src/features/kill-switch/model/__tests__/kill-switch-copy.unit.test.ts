/**
 * Which other stopped agents keep a shared virtual key disabled when one agent is restored.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type {
  AgentKillSwitchSummary,
  AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { sharedKeyHoldersOf, sharedKeyNoteOf } from "../kill-switch-copy.ts";

function stopOf({
  id,
  agentName,
  virtualKeyId,
  state,
}: {
  id: string;
  agentName: string;
  virtualKeyId: string;
  state: "applied" | "reverted";
}): AgentStopView {
  return {
    id,
    agentId: `agent-${id}`,
    agentName,
    status: "quarantined",
    severity: "high",
    approval: "immediate",
    trigger: "user",
    reason: "prompt injection in production",
    requestedBy: { userId: "user-ops", apiKeyId: null },
    decidedByUserId: null,
    restoredByUserId: null,
    targets: [
      {
        id: `${id}-key`,
        label: "Virtual key",
        target: { kind: "gateway_virtual_key", virtualKeyId },
        state,
        errorCode: null,
        appliedAt: null,
        revertedAt: null,
      },
    ],
    requestedAt: "2026-11-17T09:00:00.000Z",
    decidedAt: null,
    quarantinedAt: null,
    restoreRequestedAt: null,
    restoredAt: null,
  };
}

const summaryOf = (openStop: AgentStopView): AgentKillSwitchSummary => ({
  agentId: openStop.agentId,
  inventoryRowId: null,
  planTargetCount: 1,
  openStop,
});

describe("sharedKeyHoldersOf", () => {
  describe("when another stopped agent holds the same virtual key", () => {
    /** @scenario "The restore dialog names the stopped agents that keep a shared key disabled" */
    it("names that agent, and not one whose key is already reverted or different", () => {
      const finance = stopOf({
        id: "s1",
        agentName: "Finance close",
        virtualKeyId: "vk",
        state: "applied",
      });
      const sales = stopOf({
        id: "s2",
        agentName: "Sales pipeline",
        virtualKeyId: "vk",
        state: "applied",
      });
      const done = stopOf({ id: "s3", agentName: "Triage", virtualKeyId: "vk", state: "reverted" });
      const other = stopOf({
        id: "s4",
        agentName: "Pricing",
        virtualKeyId: "vk-2",
        state: "applied",
      });

      expect(
        sharedKeyHoldersOf({
          stop: finance,
          summaries: [finance, sales, done, other].map(summaryOf),
        }),
      ).toEqual(["Sales pipeline"]);
      expect(sharedKeyHoldersOf({ stop: null, summaries: [] })).toEqual([]);
    });
  });
});

describe("sharedKeyNoteOf", () => {
  describe("when one other agent still holds the key", () => {
    it("names it with a singular verb", () => {
      expect(sharedKeyNoteOf({ holders: ["billing-bot"] })).toBe(
        "The virtual key stays disabled while billing-bot is still stopped.",
      );
    });
  });

  describe("when several other agents still hold the key", () => {
    it("lists them with a plural verb", () => {
      expect(sharedKeyNoteOf({ holders: ["billing-bot", "refund-bot", "triage-bot"] })).toBe(
        "The virtual key stays disabled while billing-bot, refund-bot and triage-bot are still stopped.",
      );
    });
  });
});

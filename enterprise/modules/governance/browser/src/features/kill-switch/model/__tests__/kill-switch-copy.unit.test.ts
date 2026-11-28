/**
 * Which other stopped agents keep a shared target off when one agent is restored, and how the
 * Restore dialog says so for each target kind.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type {
  AgentKillSwitchSummary,
  AgentStopTarget,
  AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  sharedTargetHoldersOf,
  sharedTargetNoteOf,
  sharedTargetToastOf,
} from "../kill-switch-copy.ts";

function stopOf({
  id,
  agentName,
  target,
  state,
}: {
  id: string;
  agentName: string;
  target: AgentStopTarget;
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
        id: `${id}-target`,
        label: "Target",
        target,
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

const virtualKey = (virtualKeyId: string): AgentStopTarget => ({
  kind: "gateway_virtual_key",
  virtualKeyId,
});
const endpoint = (endpointName: string, ingestionSourceId = "src-1"): AgentStopTarget => ({
  kind: "databricks_serving_endpoint",
  ingestionSourceId,
  endpointName,
});
const alias = (agentAliasId: string, awsConnectionId = "aws-1"): AgentStopTarget => ({
  kind: "bedrock_agent_alias",
  awsConnectionId,
  region: "eu-west-1",
  agentId: "AGENT00001",
  agentAliasId,
});

/** What `Finance close` sees when others stop `same` (applied), `same` (reverted) and `other`. */
function holdersFor({ same, other }: { same: AgentStopTarget; other: AgentStopTarget }) {
  const finance = stopOf({ id: "s1", agentName: "Finance close", target: same, state: "applied" });
  const sales = stopOf({ id: "s2", agentName: "Sales pipeline", target: same, state: "applied" });
  const done = stopOf({ id: "s3", agentName: "Triage", target: same, state: "reverted" });
  const pricing = stopOf({ id: "s4", agentName: "Pricing", target: other, state: "applied" });
  return sharedTargetHoldersOf({
    stop: finance,
    summaries: [finance, sales, done, pricing].map(summaryOf),
  });
}

describe("sharedTargetHoldersOf", () => {
  describe("when another stopped agent holds the same virtual key", () => {
    /** @scenario "The restore dialog names the stopped agents that keep a shared target off" */
    it("names that agent, and not one whose key is already reverted or different", () => {
      expect(holdersFor({ same: virtualKey("vk"), other: virtualKey("vk-2") })).toEqual([
        { kind: "gateway_virtual_key", holders: ["Sales pipeline"] },
      ]);
      expect(sharedTargetHoldersOf({ stop: null, summaries: [] })).toEqual([]);
    });
  });

  describe("when another stopped agent holds the same serving endpoint of the same source", () => {
    /** @scenario "The restore dialog names the stopped agents that keep a shared target off" */
    it("names that agent, and not one stopping a same-named endpoint of another source", () => {
      expect(holdersFor({ same: endpoint("chat"), other: endpoint("chat", "src-2") })).toEqual([
        { kind: "databricks_serving_endpoint", holders: ["Sales pipeline"] },
      ]);
    });
  });

  describe("when another stopped agent holds the same Bedrock alias", () => {
    /** @scenario "The restore dialog names the stopped agents that keep a shared target off" */
    it("names that agent whichever AWS connection reaches the alias, and not another alias", () => {
      const finance = stopOf({
        id: "s1",
        agentName: "Finance close",
        target: alias("ALIAS00001"),
        state: "applied",
      });
      const sales = stopOf({
        id: "s2",
        agentName: "Sales pipeline",
        target: alias("ALIAS00001", "aws-2"),
        state: "applied",
      });
      const pricing = stopOf({
        id: "s4",
        agentName: "Pricing",
        target: alias("ALIAS00002"),
        state: "applied",
      });

      expect(
        sharedTargetHoldersOf({
          stop: finance,
          summaries: [finance, sales, pricing].map(summaryOf),
        }),
      ).toEqual([{ kind: "bedrock_agent_alias", holders: ["Sales pipeline"] }]);
    });
  });
});

describe("sharedTargetNoteOf", () => {
  describe("when one other agent still holds the key", () => {
    it("names it with a singular verb", () => {
      expect(sharedTargetNoteOf({ kind: "gateway_virtual_key", holders: ["billing-bot"] })).toBe(
        "The virtual key stays disabled while billing-bot is still stopped.",
      );
    });
  });

  describe("when several other agents still hold the key", () => {
    it("lists them with a plural verb", () => {
      expect(
        sharedTargetNoteOf({
          kind: "gateway_virtual_key",
          holders: ["billing-bot", "refund-bot", "triage-bot"],
        }),
      ).toBe(
        "The virtual key stays disabled while billing-bot, refund-bot and triage-bot are still stopped.",
      );
    });
  });

  describe("when the shared target is a serving endpoint or a Bedrock alias", () => {
    /** @scenario "The restore dialog names the stopped agents that keep a shared target off" */
    it("says what stays off for that kind", () => {
      expect(
        sharedTargetNoteOf({ kind: "databricks_serving_endpoint", holders: ["billing-bot"] }),
      ).toBe("The serving endpoint stays stopped while billing-bot is still stopped.");
      expect(
        sharedTargetNoteOf({ kind: "bedrock_agent_alias", holders: ["billing-bot", "refund-bot"] }),
      ).toBe("The Bedrock alias stays off while billing-bot and refund-bot are still stopped.");
    });
  });
});

describe("sharedTargetToastOf", () => {
  describe("when one kind of target is shared", () => {
    it("names that kind", () => {
      expect(
        sharedTargetToastOf({
          shared: [{ kind: "bedrock_agent_alias", holders: ["billing-bot"] }],
        }),
      ).toBe("The shared Bedrock alias stays off.");
    });
  });

  describe("when several kinds are shared, or none", () => {
    it("speaks of the targets, or says nothing", () => {
      expect(
        sharedTargetToastOf({
          shared: [
            { kind: "databricks_serving_endpoint", holders: ["billing-bot"] },
            { kind: "gateway_virtual_key", holders: ["billing-bot"] },
          ],
        }),
      ).toBe("The shared targets stay off.");
      expect(sharedTargetToastOf({ shared: [] })).toBeNull();
    });
  });
});

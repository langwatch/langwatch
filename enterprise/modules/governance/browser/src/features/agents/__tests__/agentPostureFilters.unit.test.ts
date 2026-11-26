/**
 * The Agents page's posture filter and the cloud source chips, held against rows from every
 * source the registry lists.
 */
import type { GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  ALL_POSTURES,
  applyAgentFilters,
  coercePosture,
  countShadowAgents,
  DEFAULT_AGENT_FILTERS,
  posturesPresentIn,
  sourceLabel,
  sourcesPresentIn,
} from "../agent-filters";

function row(overrides: Partial<GovernanceAgentRow> & Pick<GovernanceAgentRow, "id">) {
  return {
    name: overrides.id,
    environment: null,
    owner: null,
    models: [],
    source: "custom",
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo: null,
    health: null,
    registeredDaysAgo: null,
    posture: null,
    platform: null,
    ...overrides,
  } satisfies GovernanceAgentRow;
}

const ROWS: GovernanceAgentRow[] = [
  row({ id: "refund-bot", source: "aws", posture: "governed", platform: "aws_bedrock" }),
  row({ id: "claims-agent", source: "gcp", posture: "dormant", platform: "gcp_vertex" }),
  row({ id: "triage-agent", source: "ard", posture: "governed", platform: "ard" }),
  row({ id: "pricing-bot", source: "traffic", posture: "shadow" }),
  row({ id: "rogue-7", source: "traffic", posture: "shadow" }),
];

describe("the Agents page filters", () => {
  describe("given rows from AWS, Google Cloud, an ARD registry and traces", () => {
    /** @scenario "The inventory filters by posture and by cloud source" */
    it("shows only the shadow rows when the posture filter is shadow", () => {
      const visible = applyAgentFilters(ROWS, { ...DEFAULT_AGENT_FILTERS, posture: "shadow" });
      expect(visible.map((agent) => agent.id).toSorted()).toEqual(["pricing-bot", "rogue-7"]);
    });

    /** @scenario "The inventory filters by posture and by cloud source" */
    it("offers AWS, Google Cloud and ARD registry on the source filter", () => {
      const labels = sourcesPresentIn(ROWS).map((source) => sourceLabel(source));
      expect(labels).toEqual(["AWS", "Google Cloud", "ARD registry", "Traces"]);
    });

    it("narrows to one cloud source and one posture together", () => {
      const visible = applyAgentFilters(ROWS, {
        ...DEFAULT_AGENT_FILTERS,
        source: "aws",
        posture: "governed",
      });
      expect(visible.map((agent) => agent.id)).toEqual(["refund-bot"]);
    });

    it("offers only the postures the rows hold and counts the shadow ones", () => {
      expect(posturesPresentIn(ROWS)).toEqual(["governed", "shadow", "dormant"]);
      expect(countShadowAgents(ROWS)).toBe(2);
    });
  });

  describe("when the address names a posture the page cannot offer", () => {
    it("falls back to every posture", () => {
      expect(coercePosture("rogue")).toBe(ALL_POSTURES);
      expect(coercePosture(null)).toBe(ALL_POSTURES);
      expect(coercePosture("dormant")).toBe("dormant");
    });
  });

  describe("when an agent has no registry entry", () => {
    it("is hidden by any posture filter and shown without one", () => {
      const rows = [row({ id: "unlisted" })];
      expect(applyAgentFilters(rows, { ...DEFAULT_AGENT_FILTERS, posture: "governed" })).toEqual(
        [],
      );
      expect(applyAgentFilters(rows, DEFAULT_AGENT_FILTERS)).toHaveLength(1);
    });
  });
});

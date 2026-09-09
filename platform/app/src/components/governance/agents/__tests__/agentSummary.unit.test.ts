/**
 * The four figures the Agents page opens with, asserted without rendering
 * anything.
 *
 * The strip is placement over a pure fold, so this is where its behaviour is
 * pinned: the counts, the shares, the registration line and the words. What
 * the page does with the result — where it sits, and when it is absent — is
 * asserted in `pages/governance/__tests__/agentsSummaryStrip.integration.test.tsx`.
 *
 * Most of these run against `SAMPLE_AGENT_ROWS` rather than a fixture. That is
 * the point: the sample rows are what a reader actually sees, and a test over
 * a private fixture would let those rows drift into an incoherent set while
 * staying green.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { describe, expect, it } from "vitest";

import { type GovernanceAgentRow, SAMPLE_AGENT_ROWS } from "../agentRows";
import { summarizeAgentFleet } from "../agentSummary";

/** One row, with everything the caller does not care about held still. */
function agentRow(
  overrides: Partial<GovernanceAgentRow> & Pick<GovernanceAgentRow, "id">,
): GovernanceAgentRow {
  return {
    name: overrides.id,
    environment: "production",
    owner: "Platform",
    models: ["gpt-5-mini"],
    source: "custom",
    costUsd30d: null,
    requests30d: null,
    lastActiveMinutesAgo: null,
    health: null,
    registeredDaysAgo: null,
    ...overrides,
  };
}

const lineFor = (
  lines: ReturnType<typeof summarizeAgentFleet>["health"],
  key: string,
) => lines.find((line) => line.key === key)!;

describe("summarizeAgentFleet", () => {
  describe("given the sample agent rows", () => {
    const summary = summarizeAgentFleet({ rows: SAMPLE_AGENT_ROWS });

    /** @scenario "The fleet card counts the agents and captions the last thirty days" */
    it("counts every row, spells the unit out, and captions the recent arrivals", () => {
      expect(summary.fleet.count).toBe(SAMPLE_AGENT_ROWS.length);
      expect(summary.fleet.unit).toBe("agents");
      // One sample agent registered inside the window; the caption says so in
      // whole words, and names what the line beside it is.
      expect(summary.fleet.caption).toBe(
        "+1 in the last 30 days · registered over time",
      );
    });

    /** @scenario "The fleet card counts the agents and captions the last thirty days" */
    it("abbreviates nothing in the words it produces", () => {
      const words = [
        summary.fleet.unit,
        summary.fleet.caption,
        summary.fleet.registrationsLabel,
        ...summary.health.map((line) => line.label),
        ...summary.ownership.map((line) => line.label),
      ].join(" ");

      for (const abbreviation of [" d ", " req", " mo ", "agts", "unclm"]) {
        expect(words).not.toContain(abbreviation);
      }
      expect(summary.fleet.caption).toContain("days");
    });

    /** @scenario "The registration line rises to the size of the fleet" */
    it("draws one point per month of the last year, ending at the whole fleet", () => {
      expect(summary.fleet.registrations).toHaveLength(12);
      expect(summary.fleet.registrations.at(-1)).toBe(SAMPLE_AGENT_ROWS.length);
      expect(summary.fleet.registrationsLabel).toBe(
        "Agents registered over the last 12 months",
      );
    });

    /** @scenario "The registration line rises to the size of the fleet" */
    it("never falls, because an agent that registered stays registered", () => {
      const points = summary.fleet.registrations;
      // Guard the guard: a line of identical values would satisfy the
      // never-falls assertion while proving nothing, so the fleet must
      // actually have grown across the window first.
      expect(points.at(-1)!).toBeGreaterThan(points[0]!);
      for (const [index, point] of points.entries()) {
        if (index === 0) continue;
        expect(point).toBeGreaterThanOrEqual(points[index - 1]!);
      }
    });

    /** @scenario "The health card lists responding, idle and erroring separately" */
    it("carries one row per health state, each with its own count and tone", () => {
      expect(summary.health.map((line) => line.key)).toEqual([
        "responding",
        "idle",
        "erroring",
      ]);
      expect(summary.health.map((line) => line.label)).toEqual([
        "responding",
        "idle",
        "erroring",
      ]);
      expect(summary.health.map((line) => line.tone)).toEqual([
        "good",
        "neutral",
        "bad",
      ]);
      expect(lineFor(summary.health, "erroring").count).toBe(1);
    });

    /** @scenario "The ownership card names the sources the unclaimed agents came from" */
    it("splits owned from unclaimed and names where the unclaimed came from", () => {
      const owned = lineFor(summary.ownership, "owned");
      const unclaimed = lineFor(summary.ownership, "unclaimed");

      expect(owned.count + unclaimed.count).toBe(SAMPLE_AGENT_ROWS.length);
      expect(owned.label).toBe("owned");
      expect(owned.tone).toBe("good");
      // Full source names, in the order the source chip lists them, joined the
      // way a person would say it.
      expect(unclaimed.label).toBe("unclaimed, from Custom and Databricks");
      expect(unclaimed.tone).toBe("attention");
    });

    /** @scenario "Top spenders rank by share of the spend we actually measured" */
    it("ranks the three biggest spenders, biggest share first", () => {
      expect(summary.topSpenders).toHaveLength(3);
      expect(summary.topSpenders.map((agent) => agent.name)).toEqual([
        "support-copilot",
        "checkout-agent",
        "genie-revenue-analyst",
      ]);
      expect(summary.topSpenders.map((agent) => agent.shareLabel)).toEqual([
        "38%",
        "24%",
        "18%",
      ]);
    });
  });

  describe("when an agent has registered and never run", () => {
    const rows = [
      agentRow({ id: "responding-one", health: "responding" }),
      agentRow({ id: "never-run", health: null }),
    ];
    const summary = summarizeAgentFleet({ rows });

    /** @scenario "An agent that has never run is counted in the fleet but in no health state" */
    it("counts it in the fleet and in none of the three health states", () => {
      expect(summary.fleet.count).toBe(2);

      const healthTotal = summary.health.reduce(
        (total, line) => total + line.count,
        0,
      );
      expect(healthTotal).toBe(1);
      expect(lineFor(summary.health, "idle").count).toBe(0);
      expect(lineFor(summary.health, "erroring").count).toBe(0);
    });
  });

  describe("when no agent registered inside the window", () => {
    const summary = summarizeAgentFleet({
      rows: [agentRow({ id: "old-one", registeredDaysAgo: 200 })],
    });

    /** @scenario "The fleet card counts the agents and captions the last thirty days" */
    it("says so in words rather than captioning a plus zero", () => {
      expect(summary.fleet.caption).toBe(
        "No new agents in the last 30 days · registered over time",
      );
      expect(summary.fleet.unit).toBe("agent");
    });
  });

  describe("when a registration date was never measured", () => {
    const summary = summarizeAgentFleet({
      rows: [
        agentRow({ id: "dated", registeredDaysAgo: 200 }),
        agentRow({ id: "undated", registeredDaysAgo: null }),
      ],
    });

    /** @scenario "The registration line rises to the size of the fleet" */
    it("leaves that agent off the line rather than dropping it at either end", () => {
      // Two agents in the fleet, one on the line. The undated row is neither
      // backdated to the oldest point nor stacked onto the newest.
      expect(summary.fleet.count).toBe(2);
      expect(summary.fleet.registrations.at(-1)).toBe(1);
      expect(summary.fleet.registrations[0]).toBe(0);
    });
  });

  describe("when nothing is unclaimed", () => {
    const summary = summarizeAgentFleet({
      rows: [agentRow({ id: "owned-one", owner: "Platform" })],
    });

    /** @scenario "The ownership card names the sources the unclaimed agents came from" */
    it("names no sources at all", () => {
      expect(lineFor(summary.ownership, "unclaimed").count).toBe(0);
      expect(lineFor(summary.ownership, "unclaimed").label).toBe("unclaimed");
    });
  });

  describe("when one agent's spend was never measured", () => {
    const summary = summarizeAgentFleet({
      rows: [
        agentRow({ id: "measured-a", name: "measured-a", costUsd30d: 75 }),
        agentRow({ id: "measured-b", name: "measured-b", costUsd30d: 25 }),
        agentRow({ id: "unmeasured", name: "unmeasured", costUsd30d: null }),
      ],
    });

    /** @scenario "Top spenders rank by share of the spend we actually measured" */
    it("excludes it from the ranking and from the total the shares divide", () => {
      expect(summary.topSpenders.map((agent) => agent.name)).toEqual([
        "measured-a",
        "measured-b",
      ]);
      // 75 of the 100 we measured, not 75 of an invented 100 that folded the
      // unmeasured agent in as a zero — which would give the same 75% here and
      // a different one the moment the shares stop summing to a round number.
      expect(summary.topSpenders.map((agent) => agent.shareLabel)).toEqual([
        "75%",
        "25%",
      ]);
    });
  });

  describe("when no spend was measured at all", () => {
    const summary = summarizeAgentFleet({
      rows: [agentRow({ id: "never-run", costUsd30d: null })],
    });

    /** @scenario "Top spenders rank by share of the spend we actually measured" */
    it("ranks nobody rather than dividing by zero", () => {
      expect(summary.topSpenders).toEqual([]);
    });
  });
});

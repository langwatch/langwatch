/**
 * The rule that keeps `langwatch agent list` to one row per name and
 * environment once an agent has moved scope, without hiding a row that is
 * live or recent.
 *
 * @see specs/typescript-sdk/cli-agents.feature
 */
import { describe, expect, it } from "vitest";
import type { AgentResponse } from "@/client-sdk/services/agents/agents-api.service";
import { collapseStaleSiblings, STALE_SIBLING_MS } from "../collapseAgents";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

const row = (overrides: Partial<AgentResponse>): AgentResponse => ({
  id: "agent_x",
  name: "support-agent",
  type: "connected",
  config: null,
  createdAt: hoursAgo(1000),
  updatedAt: hoursAgo(1000),
  environment: "development",
  status: "offline",
  lastSeenAt: null,
  ...overrides,
});

const ids = (agents: AgentResponse[]) => agents.map((agent) => agent.id);

describe("collapseStaleSiblings()", () => {
  describe("when a name and environment has an online row, a recent offline row and a stale one", () => {
    /** @scenario "Stale sibling rows of one name and environment are collapsed" */
    it("keeps the online and recent rows and drops the stale one", () => {
      const kept = collapseStaleSiblings({
        now: NOW,
        agents: [
          row({ id: "agent_live", status: "online", lastSeenAt: hoursAgo(0) }),
          row({ id: "agent_old", lastSeenAt: hoursAgo(72) }),
          row({ id: "agent_recent", lastSeenAt: hoursAgo(1) }),
        ],
      });

      expect(ids(kept)).toEqual(["agent_live", "agent_recent"]);
    });

    it("drops an offline row exactly one day older than its sibling and keeps one a second younger", () => {
      const kept = collapseStaleSiblings({
        now: NOW,
        agents: [
          row({ id: "agent_live", status: "online", lastSeenAt: hoursAgo(0) }),
          row({ id: "agent_at_edge", lastSeenAt: new Date(NOW - STALE_SIBLING_MS).toISOString() }),
          row({ id: "agent_inside", lastSeenAt: new Date(NOW - STALE_SIBLING_MS + 1000).toISOString() }),
        ],
      });

      expect(ids(kept)).toEqual(["agent_live", "agent_inside"]);
    });
  });

  describe("when every row of a name and environment is offline", () => {
    /** @scenario "A lone offline row is never collapsed" */
    it("keeps a lone row however old it is", () => {
      const kept = collapseStaleSiblings({
        now: NOW,
        agents: [row({ id: "agent_lone", environment: "staging", lastSeenAt: hoursAgo(24 * 30) })],
      });

      expect(ids(kept)).toEqual(["agent_lone"]);
    });

    it("keeps the most recently seen row and drops the older ones", () => {
      const kept = collapseStaleSiblings({
        now: NOW,
        agents: [
          row({ id: "agent_older", lastSeenAt: hoursAgo(24 * 10) }),
          row({ id: "agent_newest", lastSeenAt: hoursAgo(24 * 3) }),
          row({ id: "agent_oldest", lastSeenAt: hoursAgo(24 * 20) }),
        ],
      });

      expect(ids(kept)).toEqual(["agent_newest"]);
    });

    it("falls back to the updated time for a row never seen", () => {
      const kept = collapseStaleSiblings({
        now: NOW,
        agents: [
          row({ id: "agent_never", lastSeenAt: null, updatedAt: hoursAgo(24 * 10) }),
          row({ id: "agent_seen", lastSeenAt: hoursAgo(2) }),
        ],
      });

      expect(ids(kept)).toEqual(["agent_seen"]);
    });
  });

  describe("when rows differ in name, environment or type", () => {
    it("never collapses across a name, an environment or an HTTP agent", () => {
      const kept = collapseStaleSiblings({
        now: NOW,
        agents: [
          row({ id: "agent_dev", lastSeenAt: hoursAgo(0) }),
          row({ id: "agent_staging", environment: "staging", lastSeenAt: hoursAgo(24 * 20) }),
          row({ id: "agent_other", name: "billing-agent", lastSeenAt: hoursAgo(24 * 20) }),
          row({ id: "agent_http", type: "http", environment: null, status: null, lastSeenAt: null }),
        ],
      });

      expect(ids(kept)).toEqual(["agent_dev", "agent_staging", "agent_other", "agent_http"]);
    });
  });
});

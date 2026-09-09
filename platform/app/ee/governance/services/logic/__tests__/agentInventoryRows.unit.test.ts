// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The union the Agents page is drawn from, and every figure it declines to
 * invent.
 *
 * The interesting assertions here are the negative ones. A row that reports a
 * spend of zero, an environment borrowed from a workspace address, or a
 * last-active time read off a provider's sync would all look like the page
 * working, which is exactly why each has a test of its own.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { describe, expect, it } from "vitest";

import {
  buildAgentInventory,
  type DiscoveredAgentRecord,
  type RegisteredAgentRecord,
} from "../agentInventoryRows";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const registered = (
  over: Partial<RegisteredAgentRecord> = {},
): RegisteredAgentRecord => ({
  id: "agent-1",
  name: "support-copilot",
  environment: "production",
  ownerUserId: null,
  createdAt: new Date(NOW.getTime() - 90 * DAY_MS),
  lastSeenAt: new Date(NOW.getTime() - HOUR_MS),
  ...over,
});

const discovered = (
  over: Partial<DiscoveredAgentRecord> = {},
): DiscoveredAgentRecord => ({
  id: "found-1",
  provider: "databricks_genie",
  displayText: "revenue-analyst",
  firstSeenAt: new Date(NOW.getTime() - 3 * DAY_MS),
  lastSeenAt: NOW,
  ...over,
});

const build = ({
  registeredAgents = [],
  discoveredAgents = [],
  memberNames = [],
}: {
  registeredAgents?: RegisteredAgentRecord[];
  discoveredAgents?: DiscoveredAgentRecord[];
  memberNames?: { userId: string; name: string }[];
} = {}) =>
  buildAgentInventory({
    registered: registeredAgents,
    discovered: discoveredAgents,
    memberNames,
    now: NOW,
  });

describe("given an organization with agents from both origins", () => {
  describe("when the agents list is built", () => {
    /** @scenario "The list holds the agents we registered and the agents we found" */
    it("lists both and names where each came from", () => {
      const { rows } = build({
        registeredAgents: [registered()],
        discoveredAgents: [discovered()],
      });

      expect(rows.map((row) => [row.name, row.source])).toEqual([
        ["support-copilot", "custom"],
        ["revenue-analyst", "databricks"],
      ]);
    });

    /** @scenario "The list holds the agents we registered and the agents we found" */
    it("keeps the two id spaces apart", () => {
      const { rows } = build({
        // The same underlying id in both tables, which is what a shared id
        // space would collapse into one React key and one ranking entry.
        registeredAgents: [registered({ id: "same" })],
        discoveredAgents: [discovered({ id: "same" })],
      });

      expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    });

    /** @scenario "A figure no read measures stays empty rather than becoming a zero" */
    it("reports no spend, no request count and no health on any row", () => {
      const { rows } = build({
        registeredAgents: [registered()],
        discoveredAgents: [discovered()],
      });

      // A guard on the guard: an empty `rows` would satisfy every assertion
      // below without proving anything.
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.costUsd30d).toBeNull();
        expect(row.requests30d).toBeNull();
        expect(row.health).toBeNull();
        expect(row.models).toEqual([]);
      }
    });
  });
});

describe("given a connected agent the organization registered from code", () => {
  describe("when the agents list is built", () => {
    /** @scenario "A registered agent is dated from when it registered" */
    it("dates it from registration and from when it was last seen", () => {
      const { rows } = build({
        registeredAgents: [registered({ ownerUserId: "user-7" })],
        memberNames: [{ userId: "user-7", name: "Dana Okafor" }],
      });

      expect(rows[0]).toMatchObject({
        registeredDaysAgo: 90,
        lastActiveMinutesAgo: 60,
        owner: "Dana Okafor",
        environment: "production",
      });
    });

    /** @scenario "A registered agent is dated from when it registered" */
    it("leaves the owner unclaimed when the row names nobody", () => {
      const { rows } = build({ registeredAgents: [registered()] });

      expect(rows[0]?.owner).toBeNull();
    });

    /** @scenario "A figure no read measures stays empty rather than becoming a zero" */
    it("reports no last-active time for an agent that never connected", () => {
      const { rows } = build({
        registeredAgents: [registered({ lastSeenAt: null })],
      });

      expect(rows[0]?.lastActiveMinutesAgo).toBeNull();
    });
  });
});

describe("given the only agents are ones a provider named", () => {
  describe("when the agents list is built", () => {
    /** @scenario "An agent a provider named carries no owner and no environment" */
    it("lists them unclaimed and with no environment", () => {
      const { rows } = build({
        discoveredAgents: [
          discovered(),
          discovered({
            id: "found-2",
            provider: "copilot_studio_dataverse",
            displayText: "hr-helpdesk",
          }),
        ],
      });

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.source)).toEqual([
        "databricks",
        "copilot_studio",
      ]);
      for (const row of rows) {
        expect(row.owner).toBeNull();
        expect(row.environment).toBeNull();
      }
    });

    /** @scenario "A figure no read measures stays empty rather than becoming a zero" */
    it("reads neither activity nor a registration date off the sync dates", () => {
      const { rows } = build({
        // Seen this instant and first seen three days ago, which is what a
        // date-borrowing mapper would report as a live, brand-new agent.
        discoveredAgents: [discovered({ lastSeenAt: NOW })],
      });

      expect(rows[0]?.lastActiveMinutesAgo).toBeNull();
      expect(rows[0]?.registeredDaysAgo).toBeNull();
    });
  });
});

describe("given an agent that appears under both origins", () => {
  describe("when the two names differ only by case and spacing", () => {
    /** @scenario "An agent found under both origins is listed once" */
    it("lists it once, as the registered record", () => {
      const { rows } = build({
        registeredAgents: [registered({ name: "support-copilot" })],
        discoveredAgents: [discovered({ displayText: "  Support-Copilot " })],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "registered:agent-1",
        source: "custom",
        environment: "production",
      });
    });
  });

  describe("when the names are merely similar", () => {
    /** @scenario "An agent found under both origins is listed once" */
    it("keeps both, because a near miss is two agents until proven otherwise", () => {
      const { rows } = build({
        registeredAgents: [registered({ name: "support-copilot" })],
        discoveredAgents: [discovered({ displayText: "support-copilot-v2" })],
      });

      expect(rows).toHaveLength(2);
    });
  });
});

describe("given a provider the page has no source chip for", () => {
  describe("when the agents list is built", () => {
    /** @scenario "An agent from a provider the page has no source for is left off" */
    it("leaves the agent off rather than filing it under Custom", () => {
      const { rows, unknownProviders } = build({
        registeredAgents: [registered()],
        discoveredAgents: [discovered({ provider: "some_future_provider" })],
      });

      expect(rows.map((row) => row.name)).toEqual(["support-copilot"]);
      expect(unknownProviders).toEqual(["some_future_provider"]);
    });

    /** @scenario "An agent from a provider the page has no source for is left off" */
    it("reports nothing when every provider is one the page knows", () => {
      const { unknownProviders } = build({
        discoveredAgents: [discovered()],
      });

      expect(unknownProviders).toEqual([]);
    });
  });
});

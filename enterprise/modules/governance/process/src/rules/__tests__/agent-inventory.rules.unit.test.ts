// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type {
  DiscoveredAgentRecord,
  RegisteredAgentRecord,
} from "../agent-inventory-rows.rules.ts";
import { buildAgentInventory } from "../agent-inventory.rules.ts";

const NOW_DATE = new Date("2026-09-09T12:00:00.000Z");
const NOW = fromDate(NOW_DATE);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const registered = (over: Partial<RegisteredAgentRecord> = {}): RegisteredAgentRecord => ({
  id: "agent-1",
  name: "support-copilot",
  environment: "production",
  ownerUserId: null,
  createdAt: new Date(NOW_DATE.getTime() - 90 * DAY_MS),
  lastSeenAt: new Date(NOW_DATE.getTime() - HOUR_MS),
  ...over,
});

const discovered = (over: Partial<DiscoveredAgentRecord> = {}): DiscoveredAgentRecord => ({
  id: "found-1",
  provider: "databricks_genie",
  displayText: "revenue-analyst",
  firstSeenAt: NOW.subtract({ milliseconds: 3 * DAY_MS }),
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
    memberNames: new Map(memberNames.map((member) => [member.userId, member.name])),
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
      expect(rows.map((row) => row.source)).toEqual(["databricks", "copilot_studio"]);
      for (const row of rows) {
        expect(row.owner).toBeNull();
        expect(row.environment).toBeNull();
      }
    });

    /** @scenario "A figure no read measures stays empty rather than becoming a zero" */
    it("reads neither activity nor a registration date off the sync dates", () => {
      const { rows } = build({
        discoveredAgents: [discovered({ lastSeenAt: NOW })],
      });

      expect(rows[0]?.lastActiveMinutesAgo).toBeNull();
      expect(rows[0]?.registeredDaysAgo).toBeNull();
    });
  });
});

describe("given a registered agent and a provider agent that share a name", () => {
  describe("when the two names differ only by case and spacing", () => {
    /** @scenario "A shared name is not evidence that two agents are one" */
    it("keeps both rows, each stating its own origin", () => {
      const { rows } = build({
        registeredAgents: [registered({ name: "support-copilot" })],
        discoveredAgents: [discovered({ displayText: "  Support-Copilot " })],
      });

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => [row.id, row.source])).toEqual([
        ["registered:agent-1", "custom"],
        ["discovered:found-1", "databricks"],
      ]);
    });

    /** @scenario "A shared name is not evidence that two agents are one" */
    it("leaves the provider row's fields as unmeasured as any other", () => {
      const { rows } = build({
        registeredAgents: [registered({ name: "support-copilot" })],
        discoveredAgents: [discovered({ displayText: "support-copilot" })],
      });

      expect(rows[1]).toMatchObject({
        owner: null,
        environment: null,
        registeredDaysAgo: null,
        lastActiveMinutesAgo: null,
      });
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

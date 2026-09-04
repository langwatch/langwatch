/**
 * The stale-connected-agent visibility rule applied at the query, not read
 * back into memory and filtered after: a connected agent unseen for thirty
 * days drops out of every list the same way an archived one does (ADR-128).
 *
 * @see specs/agents/connected-agents.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";
import { PrismaAgentRepository } from "../prisma.agent.repository";

type Row = Record<string, unknown>;

/** A predicate matcher wide enough for the `where` shapes this repository builds. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return (condition as Row[]).every((clause) => matches(row, clause));
    if (key === "OR") return (condition as Row[]).some((clause) => matches(row, clause));
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (typeof condition === "object" && condition !== null) {
      const test = condition as Row;
      if ("not" in test) return value !== test.not;
      if ("gte" in test) return value instanceof Date && value.getTime() >= (test.gte as Date).getTime();
      if ("in" in test) return (test.in as unknown[]).includes(value);
      return false;
    }
    return value === condition;
  });
}

function connectedAgentRow(overrides: Row = {}): Row {
  return {
    id: "agent_1",
    projectId: "proj_1",
    name: "support-agent",
    type: "connected",
    config: { sdk: { name: "langwatch", version: "1.0.0", language: "python" } },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: "support-agent@production",
    lastSeenAt: new Date(),
    ...overrides,
  };
}

function database(rows: Row[]): PrismaClient {
  return {
    agent: {
      findMany: async ({ where }: { where?: Row } = {}) =>
        rows.filter((row) => matches(row, where)),
    },
  } as unknown as PrismaClient;
}

describe("PrismaAgentRepository.findAll", () => {
  describe("when one connected agent was last seen thirty one days ago and another yesterday", () => {
    /** @scenario "A connected agent unseen for thirty days is not listed" */
    it("lists only the recently seen agent", async () => {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = [
        connectedAgentRow({ id: "agent_stale", lastSeenAt: thirtyOneDaysAgo }),
        connectedAgentRow({ id: "agent_fresh", lastSeenAt: yesterday }),
      ];
      const repository = PrismaAgentRepository.create(database(rows));

      const agents = await repository.findAll({ projectId: "proj_1" });

      expect(agents.map((agent) => agent.id)).toEqual(["agent_fresh"]);
    });
  });
});

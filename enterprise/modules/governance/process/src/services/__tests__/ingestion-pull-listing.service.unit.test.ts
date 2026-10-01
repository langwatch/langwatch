import {
  type GovernanceIngestionSource,
  LISTING_FAILED_REASON,
} from "@langwatch/enterprise-governance-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type {
  IngestionPullListingOutcome,
  IngestionPullListingOutcomeChannel,
  IngestionPullListingRefusal,
} from "../../app/governance.members.ts";
import type { AgentSyncResult } from "../agent-discovery.service.ts";
import { IngestionPullListingService } from "../ingestion-pull-listing.service.ts";
import type { PeopleSyncResult } from "../person-listing.service.ts";

class RecordingOutcomes implements IngestionPullListingOutcomeChannel {
  readonly recorded: { kind: string; input: IngestionPullListingOutcome }[] = [];
  failWith: Error | null = null;

  private async record(kind: string, input: IngestionPullListingOutcome): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.recorded.push({ kind, input });
  }
  agentsListed(input: IngestionPullListingOutcome & { agentCount: number }) {
    return this.record("agentsListed", input);
  }
  agentsListingRefused(input: IngestionPullListingRefusal) {
    return this.record("agentsListingRefused", input);
  }
  peopleListed(
    input: IngestionPullListingOutcome & {
      directoryPersonCount: number;
      withheldPersonCount: number;
    },
  ) {
    return this.record("peopleListed", input);
  }
  peopleListingRefused(input: IngestionPullListingRefusal) {
    return this.record("peopleListingRefused", input);
  }
}

function source(id: string): GovernanceIngestionSource {
  return {
    id,
    organizationId: "org-1",
    teamId: null,
    sourceType: "anthropic_compliance",
    name: "Anthropic",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: {},
    pollerCursor: null,
    errorCount: 0,
    pullSchedule: null,
    status: "active",
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: null,
  };
}

function listing({
  agents = () => Promise.reject(new Error("uncalled")),
  people = () => Promise.reject(new Error("uncalled")),
  sourceExists = true,
}: {
  agents?: () => Promise<AgentSyncResult>;
  people?: () => Promise<PeopleSyncResult>;
  sourceExists?: boolean;
}) {
  const outcomes = new RecordingOutcomes();
  const { logger, lines } = createTestLogger();
  const calls = { agents: 0 };
  const service = IngestionPullListingService.create({
    sources: {
      findById: async (id: string) => (sourceExists ? source(id) : null),
    },
    agents: {
      syncFromSource: () => {
        calls.agents += 1;
        return agents();
      },
    },
    people: { syncFromSource: people },
    outcomes,
    clock: () => 9_000,
    logger,
  });
  return { service, outcomes, lines, calls };
}

const execution = (attempt = 1) => ({
  tenantId: "project-1",
  attempt,
  listing: { sourceId: "source-1", requestId: "req-1", requestedAt: 1_000 },
});

describe("agent listing outbox effect", () => {
  describe("when the provider names agents", () => {
    it("records the count against the request that asked", async () => {
      const { service, outcomes } = listing({
        agents: async () => ({ outcome: "listed", recorded: 3 }),
      });
      await service.listAgents(execution());

      expect(outcomes.recorded).toEqual([
        {
          kind: "agentsListed",
          input: {
            tenantId: "project-1",
            sourceId: "source-1",
            requestId: "req-1",
            requestedAt: 1_000,
            occurredAt: 9_000,
            agentCount: 3,
          },
        },
      ]);
    });
  });

  describe("when the provider answers with an empty list", () => {
    it("records a listing of zero, not a refusal", async () => {
      const { service, outcomes } = listing({ agents: async () => ({ outcome: "empty" }) });
      await service.listAgents(execution());

      expect(outcomes.recorded).toMatchObject([{ kind: "agentsListed", input: { agentCount: 0 } }]);
    });
  });

  describe("when the provider refuses", () => {
    it("records the refusal with its reason and status, and does not retry", async () => {
      const { service, outcomes, calls } = listing({
        agents: async () => ({
          outcome: "refused",
          refusal: { reason: "unauthorized", status: 403 },
        }),
      });
      await service.listAgents(execution());

      expect(calls.agents).toBe(1);
      expect(outcomes.recorded).toMatchObject([
        { kind: "agentsListingRefused", input: { reason: "unauthorized", status: 403 } },
      ]);
    });
  });

  describe("when the source no longer exists", () => {
    it("records a not_found refusal without asking a provider", async () => {
      const { service, outcomes, calls } = listing({ sourceExists: false });
      await service.listAgents(execution());

      expect(calls.agents).toBe(0);
      expect(outcomes.recorded).toMatchObject([
        { kind: "agentsListingRefused", input: { reason: "not_found", status: null } },
      ]);
    });
  });

  describe("when our own side gives out", () => {
    const failing = () => Promise.reject(new Error("socket hang up: token=secret"));

    it("rethrows before the final attempt so the outbox retries", async () => {
      const { service, outcomes } = listing({ agents: failing });

      await expect(service.listAgents(execution(1))).rejects.toThrow("socket hang up");
      expect(outcomes.recorded).toEqual([]);
    });

    it("records a listing_failed refusal once retries run out, keeping the message out", async () => {
      const { service, outcomes, lines } = listing({ agents: failing });
      await service.listAgents(execution(3));

      expect(outcomes.recorded).toEqual([
        {
          kind: "agentsListingRefused",
          input: expect.objectContaining({ reason: LISTING_FAILED_REASON, status: null }),
        },
      ]);
      expect(JSON.stringify(outcomes.recorded)).not.toContain("secret");
      expect(lines.findLine("warn", "attempts spent")).toBeDefined();
    });
  });

  describe("when the outcome command itself fails", () => {
    it("rethrows so the outbox redelivers rather than losing the outcome", async () => {
      const { service, outcomes } = listing({
        agents: async () => ({ outcome: "listed", recorded: 1 }),
      });
      outcomes.failWith = new Error("queue down");

      await expect(service.listAgents(execution())).rejects.toThrow("queue down");
    });
  });
});

describe("people listing outbox effect", () => {
  describe("when the provider names people", () => {
    it("records both counts against the request that asked", async () => {
      const { service, outcomes } = listing({
        people: async () => ({ outcome: "listed", recorded: 7, named: 10, withheld: 3 }),
      });
      await service.listPeople(execution());

      expect(outcomes.recorded).toMatchObject([
        { kind: "peopleListed", input: { directoryPersonCount: 10, withheldPersonCount: 3 } },
      ]);
    });
  });

  describe("when the provider names nobody", () => {
    it("records a listing of zero rather than a refusal", async () => {
      const { service, outcomes } = listing({ people: async () => ({ outcome: "empty" }) });
      await service.listPeople(execution());

      expect(outcomes.recorded).toMatchObject([
        { kind: "peopleListed", input: { directoryPersonCount: 0, withheldPersonCount: 0 } },
      ]);
    });
  });

  describe("when the provider refuses", () => {
    it("records the reason and the status, and never a listing", async () => {
      const { service, outcomes } = listing({
        people: async () => ({
          outcome: "refused",
          refusal: { reason: "not_configured", status: null },
        }),
      });
      await service.listPeople(execution());

      expect(outcomes.recorded).toMatchObject([
        { kind: "peopleListingRefused", input: { reason: "not_configured", status: null } },
      ]);
    });
  });
});

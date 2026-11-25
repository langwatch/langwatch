import {
  type GovernanceIngestionSource,
  PULL_FAILED_ERROR_CODE,
  PULL_REFUSED_ERROR_CODE,
} from "@langwatch/enterprise-governance-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type { AgentSyncResult } from "../../features/agents/services/agent-discovery.service.ts";
import type {
  IngestionPullListingOutcome,
  IngestionPullListingOutcomeChannel,
  IngestionPullListingRefusal,
} from "../../features/ingestion-pull/services/ingestion-pull-listing.service.ts";
import { IngestionPullListingService } from "../../features/ingestion-pull/services/ingestion-pull-listing.service.ts";
import type { IngestionPullMetricsSink } from "../../features/ingestion-pull/services/ingestion-pull-metrics.service.ts";
import type { IngestionPullOutcomeChannel } from "../../features/ingestion-pull/services/ingestion-pull.service.ts";
import { IngestionPullService } from "../../features/ingestion-pull/services/ingestion-pull.service.ts";

type Completed = Parameters<IngestionPullOutcomeChannel["completed"]>[0];
type Failed = Parameters<IngestionPullOutcomeChannel["failed"]>[0];

class RecordingRunOutcome implements IngestionPullOutcomeChannel {
  readonly completedCalls: Completed[] = [];
  readonly failedCalls: Failed[] = [];
  async completed(input: Completed): Promise<void> {
    this.completedCalls.push(input);
  }
  async failed(input: Failed): Promise<void> {
    this.failedCalls.push(input);
  }
}

class RecordingListingOutcomes implements IngestionPullListingOutcomeChannel {
  readonly recorded: { kind: string; input: IngestionPullListingOutcome }[] = [];
  async agentsListed(input: IngestionPullListingOutcome & { agentCount: number }) {
    this.recorded.push({ kind: "agentsListed", input });
  }
  async agentsListingRefused(input: IngestionPullListingRefusal) {
    this.recorded.push({ kind: "agentsListingRefused", input });
  }
  async peopleListed(input: IngestionPullListingOutcome) {
    this.recorded.push({ kind: "peopleListed", input });
  }
  async peopleListingRefused(input: IngestionPullListingRefusal) {
    this.recorded.push({ kind: "peopleListingRefused", input });
  }
}

class NoMetrics implements IngestionPullMetricsSink {
  count(): void {}
  observeDuration(): void {}
}

function source({
  id,
  sourceType,
}: {
  id: string;
  sourceType: GovernanceIngestionSource["sourceType"];
}): GovernanceIngestionSource {
  return {
    id,
    organizationId: "org-1",
    teamId: null,
    sourceType,
    name: "ACME AWS",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: { awsConnectionId: "awsconn_1", regions: ["eu-west-1"] },
    pollerCursor: "cursor-1",
    errorCount: 0,
    pullSchedule: "0 * * * *",
    status: "active",
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: null,
  };
}

function scheduledWorld({
  sourceType = "aws_bedrock_agents",
  agents = async () => ({ outcome: "listed", recorded: 2 }),
  findSource = async (id: string) => source({ id, sourceType }),
}: {
  sourceType?: GovernanceIngestionSource["sourceType"];
  agents?: () => Promise<AgentSyncResult>;
  findSource?: (id: string) => Promise<GovernanceIngestionSource>;
} = {}) {
  const listingOutcomes = new RecordingListingOutcomes();
  const runOutcome = new RecordingRunOutcome();
  const pulls: string[] = [];
  const { logger } = createTestLogger();
  const listing = IngestionPullListingService.create({
    sources: { findById: findSource },
    agents: { syncFromSource: agents },
    people: { syncFromSource: () => Promise.reject(new Error("uncalled")) },
    outcomes: listingOutcomes,
    clock: () => 9_000,
    logger,
  });
  const service = IngestionPullService.create({
    runPort: {
      run: async ({ sourceId }) => {
        pulls.push(sourceId);
        return { nextCursor: "cursor-2", eventCount: 4 };
      },
    },
    outcomePort: runOutcome,
    metrics: new NoMetrics(),
    scheduledListing: listing,
    options: { clock: () => 9_000, logger, maxAttempts: 3 },
  });
  const wake = ({ attempt = 1 }: { attempt?: number } = {}) =>
    service.execute({
      tenantId: "project-1",
      attempt,
      pull: { sourceId: "source-1", runId: "run-7", scheduledFor: 5_000, cursor: "cursor-1" },
    });
  return { wake, listingOutcomes, runOutcome, pulls };
}

describe("given an AWS source on an hourly schedule", () => {
  describe("when its scheduled run wakes", () => {
    /** @scenario "A cloud source lists its agents on its own schedule" */
    it("lists its agents, records them on the run and attempts no usage pull", async () => {
      const world = scheduledWorld();

      await world.wake();

      expect(world.pulls).toEqual([]);
      expect(world.listingOutcomes.recorded).toEqual([
        {
          kind: "agentsListed",
          input: {
            tenantId: "project-1",
            sourceId: "source-1",
            requestId: "run:run-7",
            requestedAt: 5_000,
            occurredAt: 9_000,
            agentCount: 2,
          },
        },
      ]);
      expect(world.runOutcome.completedCalls).toMatchObject([
        { runId: "run-7", nextCursor: "cursor-1", eventCount: 0 },
      ]);
    });
  });

  describe("when the provider refuses the scheduled listing", () => {
    it("records the refusal and ends the run without a retry", async () => {
      const world = scheduledWorld({
        agents: async () => ({
          outcome: "refused",
          refusal: { reason: "unauthorized", status: 403 },
        }),
      });

      await world.wake();

      expect(world.pulls).toEqual([]);
      expect(world.listingOutcomes.recorded.map((entry) => entry.kind)).toEqual([
        "agentsListingRefused",
      ]);
      expect(world.runOutcome.failedCalls).toMatchObject([
        { runId: "run-7", errorCode: PULL_REFUSED_ERROR_CODE, retryable: false },
      ]);
    });
  });
});

describe("given the source lookup fails while a list-only run wakes", () => {
  const failingLookup = () => Promise.reject(new Error("database unavailable"));

  it("throws on an early attempt so the run is retried", async () => {
    const world = scheduledWorld({ findSource: failingLookup });

    await expect(world.wake({ attempt: 1 })).rejects.toThrow("database unavailable");

    expect(world.runOutcome.failedCalls).toEqual([]);
    expect(world.pulls).toEqual([]);
  });

  it("settles the run as failed on the final attempt", async () => {
    const world = scheduledWorld({ findSource: failingLookup });

    await world.wake({ attempt: 3 });

    expect(world.runOutcome.failedCalls).toMatchObject([
      { runId: "run-7", errorCode: PULL_FAILED_ERROR_CODE, retryable: false },
    ]);
    expect(world.pulls).toEqual([]);
  });
});

describe("given a source that pulls usage", () => {
  it("is pulled as before and records no agent listing", async () => {
    const world = scheduledWorld({ sourceType: "anthropic_compliance" });

    await world.wake();

    expect(world.pulls).toEqual(["source-1"]);
    expect(world.listingOutcomes.recorded).toEqual([]);
  });
});

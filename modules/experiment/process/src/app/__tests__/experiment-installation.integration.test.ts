/**
 * Experiment installed the way the worker installs it, over the memory tier and
 * real peer resolution: an empty ClickHouse, a Redis nothing reads at boot, no queue.
 * @vitest-environment node
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { createApp } from "@langwatch/kernel";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { memoryStores } from "@langwatch/process-stores";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createTestLogger } from "@langwatch/test-harness";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { experimentServer } from "../../experiment.server.ts";

/** A ClickHouse that holds no rows: every read answers empty. */
class EmptyDriver implements QueryDriver {
  execute<Row>(): Promise<QueryResult<Row>> {
    return Promise.resolve({ rows: [] });
  }

  insert(_request: InsertRequest): Promise<void> {
    return Promise.resolve();
  }

  command(): Promise<void> {
    return Promise.resolve();
  }
}

async function bootWorker() {
  let retentionReads = 0;
  const eventing = new EventSourcing({
    enabled: false,
    participation: "consume",
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const runtime = await createApp({ role: "worker" })
    .withModules([experimentServer])
    .withStores(memoryStores())
    .withEventing(eventing)
    .withRelational(createApiFixture<ProcessMembers["prisma"]>({}, "prisma (unused at boot)"))
    .withAnalytical(new ClickHouseQueryClient({ driver: new EmptyDriver() }))
    .withKeyvalue(
      createApiFixture<NonNullable<ProcessMembers["redis"]>>({}, "redis (unused at boot)"),
    )
    .withObservability((observability) => observability.withLogging(createTestLogger().logger))
    .provide({
      workflow: createApiFixture<WorkflowApi>({}),
      dataset: createApiFixture<DatasetApi>({}),
      monitor: createApiFixture<MonitorApi>({}),
      agent: createApiFixture<AgentApi>({}),
      evaluator: createApiFixture<EvaluatorApi>({}),
      prompt: createApiFixture<PromptApi>({}),
      authz: createApiFixture<AuthzApi>({}),
      project: createApiFixture<ProjectApi>({}),
      entitlement: createApiFixture<EntitlementApi>({}),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => {
          retentionReads += 1;
          return 49;
        },
      }),
    })
    .boot();
  return { runtime, eventing, retentionReads: () => retentionReads };
}

describe("experiment installed in the worker", () => {
  /** @scenario "The worker registers the run pipeline from experiment's own declaration" */
  it("registers experiment_run_processing from its own declaration", async () => {
    const { runtime, eventing } = await bootWorker();

    try {
      const pipelines = eventing.definitions.map((definition) => definition.metadata.name);
      expect(pipelines).toContain("experiment_run_processing");
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Building the run pipeline reads no retention from its peer" */
  it("reads no retention from its peer while the pipeline is built", async () => {
    const { runtime, retentionReads } = await bootWorker();

    try {
      expect(retentionReads()).toBe(0);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "A run no experiment recorded answers not recorded" */
  it("answers a run no experiment recorded as not recorded", async () => {
    const { runtime } = await bootWorker();

    try {
      await expect(
        runtime
          .service(ExperimentApi)
          .lookupExperimentId({ tenantId: "project_1", runId: "run_1" }),
      ).resolves.toEqual({ kind: "not_recorded" });
    } finally {
      await runtime.stop();
    }
  });
});

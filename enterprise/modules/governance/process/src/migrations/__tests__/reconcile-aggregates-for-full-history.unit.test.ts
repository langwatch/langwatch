// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: specs/governance/aggregate-project.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  AGGREGATE_RECONCILE_PROCESS_NAME,
  aggregateReconcileProcessKey,
} from "../../eventing/aggregate-reconcile.process.ts";
import { bootGovernanceWorker, runStep } from "./governance-deploy-steps.fixture.ts";

const STEP_ID = "governance:reconcile-aggregates-for-full-history";
const AGGREGATES = [
  { id: "agg_a", organizationId: "org_1" },
  { id: "agg_b", organizationId: "org_2" },
];

async function bootOver() {
  const processStore = InMemoryProcessStore.createForTesting();
  const project = createApiFixture<ProjectApi>({
    findAllLiveAggregates: async () => AGGREGATES,
  });
  const worker = await bootGovernanceWorker({ project, processStore });
  const queued = async () =>
    (
      await Promise.all(
        AGGREGATES.map(({ id, organizationId }) =>
          processStore.findMessagesByRef({
            ref: {
              processName: AGGREGATE_RECONCILE_PROCESS_NAME,
              projectId: organizationId,
              processKey: aggregateReconcileProcessKey({ aggregateProjectId: id }),
            },
          }),
        ),
      )
    )
      .flat()
      .map((message) => message.messageKey);
  return { ...worker, queued };
}

describe("given a worker installing governance over two live aggregates", () => {
  /** @scenario "Existing aggregates are re-checked once after the full-history change" */
  it("declares a background data step needing the old writers gone", async () => {
    const { runtime, step } = await bootOver();
    try {
      expect(step(STEP_ID)).toMatchObject({
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
      });
    } finally {
      await runtime.stop();
    }
  });

  describe("when the step runs twice", () => {
    /** @scenario "Existing aggregates are re-checked once after the full-history change" */
    it("queues one reconcile per aggregate under the backfill key, and none on the re-run", async () => {
      const { runtime, step, queued } = await bootOver();
      try {
        const { report, saves } = await runStep({ step: step(STEP_ID) });
        await runStep({ step: step(STEP_ID) });

        expect(await queued()).toEqual([
          "reconcile:agg_a:backfill:full-history",
          "reconcile:agg_b:backfill:full-history",
        ]);
        expect(saves).toEqual([
          { afterAggregateProjectId: "agg_a" },
          { afterAggregateProjectId: "agg_b" },
        ]);
        expect(report).toMatchObject({ afterAggregateProjectId: "agg_b", queued: 2 });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the step resumes after the first aggregate", () => {
    it("queues only the aggregates after it", async () => {
      const { runtime, step, queued } = await bootOver();
      try {
        await runStep({ step: step(STEP_ID), resumeFrom: { afterAggregateProjectId: "agg_a" } });

        expect(await queued()).toEqual(["reconcile:agg_b:backfill:full-history"]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the step runs as a dry run", () => {
    /** @scenario "Existing aggregates are re-checked once after the full-history change" */
    it("counts the aggregates and queues nothing", async () => {
      const { runtime, step, queued } = await bootOver();
      try {
        const { report, saves } = await runStep({ step: step(STEP_ID), dryRun: true });

        expect(await queued()).toEqual([]);
        expect(saves).toEqual([]);
        expect(report).toMatchObject({ queued: 2, dryRun: true });
      } finally {
        await runtime.stop();
      }
    });
  });
});

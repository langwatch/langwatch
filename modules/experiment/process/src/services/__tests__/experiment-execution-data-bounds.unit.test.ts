import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { ExperimentEvaluationInputError } from "@langwatch/experiment-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * The tier-effective inline row bound: loadExecutionData refuses rows above
 * the plan's experimentInlineRowsMax even when a transport schema let them
 * through, and loads rows at the tier. Free 1000, paid 2000, enterprise 4000.
 */
import { describe, expect, it } from "vitest";

import {
  ExperimentExecutionDataService,
  type ExperimentWorkflowDsl,
} from "../experiment-execution-data.service.ts";

const PROJECT_ID = "project-1";

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ row: index }));

function services(tier: "free" | "paid" | "enterprise" = "free") {
  const planType = { free: "FREE", paid: "PRO", enterprise: "ENTERPRISE" }[tier];
  return {
    datasets: createApiFixture<DatasetApi>(),
    prompts: createApiFixture<PromptApi>(),
    agents: createApiFixture<AgentApi>(),
    workflows: createApiFixture<ExperimentWorkflowDsl>(),
    entitlements: {
      requestBound: ({ key }: { key: RequestBoundKey; organizationId: string }) =>
        Promise.resolve(resolveRequestBound(key, planType)),
    },
    projects: {
      getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
    },
  };
}

const load = (
  tier: "free" | "paid" | "enterprise",
  rowCount: number,
): ReturnType<ExperimentExecutionDataService["loadExecutionData"]> =>
  ExperimentExecutionDataService.create().loadExecutionData({
    projectId: PROJECT_ID,
    dataset: { type: "inline", columns: [] },
    targets: [],
    evaluators: [],
    services: services(tier),
    inputs: { data: rows(rowCount) },
  });

describe("loadExecutionData row bound", () => {
  it.each([
    ["free", 1001, 1000],
    ["paid", 2001, 2000],
    ["enterprise", 4001, 4000],
  ] as const)(
    "refuses %i rows to a %s-tier caller with the tier number in the error",
    async (tier, count, bound) => {
      const refusal = load(tier, count);
      await expect(refusal).rejects.toBeInstanceOf(ExperimentEvaluationInputError);
      await expect(refusal).rejects.toMatchObject({
        httpStatus: 422,
        message: expect.stringMatching(new RegExp(`${count}.*${bound}`)),
      });
    },
  );

  it("loads exactly the tier number of rows", async () => {
    const result = await load("paid", 2000);
    expect(result.datasetRows).toHaveLength(2000);
  });

  it("refuses rows the transport schema allowed: 3000 rows read as a free caller", async () => {
    // 3000 parses under the enterprise ceiling of 4000; a free plan still
    // refuses it at the load. This is the seam the schema cannot see.
    await expect(load("free", 3000)).rejects.toMatchObject({ httpStatus: 422 });
  });
});

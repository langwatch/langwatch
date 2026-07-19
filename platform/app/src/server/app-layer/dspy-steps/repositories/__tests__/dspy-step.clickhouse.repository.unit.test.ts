import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import type { DspyStepData } from "../../types";
import { DspyStepClickHouseRepository } from "../dspy-step.clickhouse.repository";

function makeStep(overrides: Partial<DspyStepData> = {}): DspyStepData {
  return {
    tenantId: "project-1",
    experimentId: "exp-1",
    runId: "run-1",
    stepIndex: "0",
    score: 0.5,
    label: "score",
    optimizerName: "foo",
    optimizerParameters: {},
    predictors: [],
    examples: [],
    llmCalls: [],
    createdAt: 1000,
    insertedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function resolverReturning(traces: number | null): RetentionPolicyResolver {
  return {
    resolve: vi
      .fn()
      .mockResolvedValue(
        traces === null ? null : { traces, scenarios: 0, experiments: 0 },
      ),
  };
}

function setup(resolver: RetentionPolicyResolver | null) {
  const insert = vi.fn().mockResolvedValue(undefined);
  // getStep() runs before upsert; an empty result means "no existing row".
  const query = vi.fn().mockResolvedValue({ json: async () => [] });
  const repo = new DspyStepClickHouseRepository(
    async () => ({ insert, query }) as any,
    resolver,
  );
  const insertedRetentionDays = () =>
    insert.mock.calls[0]![0].values[0]._retention_days;
  return { repo, insertedRetentionDays };
}

describe("DspyStepClickHouseRepository retention stamping", () => {
  describe("given the project has a traces retention policy", () => {
    /** @scenario Trace pipeline stamps _retention_days from traces category */
    it("stamps the resolved traces retention on upsertStep", async () => {
      const { repo, insertedRetentionDays } = setup(resolverReturning(49));

      await repo.upsertStep(makeStep());

      expect(insertedRetentionDays()).toBe(49);
    });

    it("stamps the resolved traces retention on insertStepDirect", async () => {
      const { repo, insertedRetentionDays } = setup(resolverReturning(49));

      await repo.insertStepDirect(makeStep());

      expect(insertedRetentionDays()).toBe(49);
    });
  });

  describe("given the project has no retention policy", () => {
    it("stamps the platform default on upsertStep", async () => {
      const { repo, insertedRetentionDays } = setup(resolverReturning(null));

      await repo.upsertStep(makeStep());

      expect(insertedRetentionDays()).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });

  describe("given no retention resolver is wired", () => {
    it("falls back to the platform default", async () => {
      const { repo, insertedRetentionDays } = setup(null);

      await repo.upsertStep(makeStep());

      expect(insertedRetentionDays()).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });
});

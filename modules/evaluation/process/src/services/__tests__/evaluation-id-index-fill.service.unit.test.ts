/**
 * Evaluation's id-index fill around the repository's walk: per ClickHouse target it raises the
 * index's retention, then sets that target's flag. Spec: specs/clickhouse/id-index-reads.feature
 */
import type { IdIndexFillReport } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { EvaluationRunRepository } from "../../repositories/evaluation.repository.ts";
import { EvaluationIdIndexFillService } from "../evaluation-id-index-fill.service.ts";

const REPORT: IdIndexFillReport = {
  targetsDone: ["shared"],
  targetsFailed: [],
  cursor: null,
  done: 1,
  total: 1,
  batches: 1,
  retries: 0,
};

function walkOf({ targets }: { targets: { key: string; organizationId?: string }[] }) {
  const fillIdIndexes = vi.fn<EvaluationRunRepository["fillIdIndexes"]>(async (options) => {
    for (const target of targets) {
      await options.beforeFlag({
        target: { ...target, flagTargets: [target.key] },
        indexes: ["evaluation_runs_id_index"],
      });
      await options.setFlag({ target: target.key });
    }
    return REPORT;
  });
  const raiseIdIndexRetention = vi.fn<DataRetentionApi["raiseIdIndexRetention"]>(async () => ({
    tables: [],
  }));
  const setEnabled = vi.fn<FeatureFlagApi["setEnabled"]>(async () => undefined);
  const service = EvaluationIdIndexFillService.create({
    repository: { fillIdIndexes },
    flags: createApiFixture<FeatureFlagApi>({ setEnabled }),
    retention: createApiFixture<DataRetentionApi>({ raiseIdIndexRetention }),
  });
  return { service, fillIdIndexes, raiseIdIndexRetention, setEnabled };
}

const run = {
  checkpoint: { resumeFrom: null, save: async () => undefined },
  dryRun: false,
  signal: new AbortController().signal,
};

describe("Evaluation's id-index fill", () => {
  describe("when the walk finishes the shared target and a private one", () => {
    it("raises each target's index retention before it sets that target's flag", async () => {
      const { service, raiseIdIndexRetention, setEnabled } = walkOf({
        targets: [{ key: "shared" }, { key: "org_private", organizationId: "org_private" }],
      });

      const report = await service.fill(run);

      expect(report).toEqual(REPORT);
      expect(raiseIdIndexRetention.mock.calls.map(([input]) => input)).toEqual([
        { indexes: ["evaluation_runs_id_index"] },
        { organizationId: "org_private", indexes: ["evaluation_runs_id_index"] },
      ]);
      expect(setEnabled.mock.calls.map(([input]) => [input.key, input.enabled])).toEqual([
        ["clickhouse_id_index_evaluation_shared", true],
        ["clickhouse_id_index_evaluation_org_private", true],
      ]);
      expect(raiseIdIndexRetention.mock.invocationCallOrder[0]).toBeLessThan(
        setEnabled.mock.invocationCallOrder[0] ?? 0,
      );
    });
  });

  describe("when the walk is a dry run", () => {
    it("hands the repository the dry-run flag", async () => {
      const { service, fillIdIndexes } = walkOf({ targets: [] });

      await service.fill({ ...run, dryRun: true });

      expect(fillIdIndexes).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });
  });
});

/**
 * @vitest-environment node
 * trace_processing declares each tenant's retention from data retention (ARCHITECTURE §9).
 * Spec: packages/eventing/specs/pipeline-retention.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";

const RETAINED = { traces: 365, scenarios: 30, experiments: 30 };

describe("TraceProcessingRuntimeAdapter", () => {
  describe("given a consuming role", () => {
    /** @scenario "A module's pipeline declares each tenant's retention from data retention" */
    it("declares each tenant's retention as data retention resolves it", async () => {
      const peers = createApiFixture<TraceProcessingPipelineInput["peers"]>({
        dataRetention: createApiFixture<DataRetentionApi>({
          getResolvedForProject: async () => RETAINED,
        }),
      });
      const pipeline = TraceProcessingRuntimeAdapter.create({
        processName: "langwatch-test",
        tokenizer: createApiFixture<TraceProcessingPipelineInput["tokenizer"]>(),
        peers,
        repositories: MemoryTraceRepositories.create(),
        canonicalisation: TraceCanonicalisationService.create(),
        commands: createApiFixture<TraceProcessingPipelineInput["commands"]>(),
        findSummary: async () => null,
        recordTrackedEvent: async () => undefined,
        broadcast: createApiFixture<TraceProcessingPipelineInput["broadcast"]>(),
        milestones: createApiFixture<TraceProcessingPipelineInput["milestones"]>(),
      }).build({ participation: "consume" });

      await expect(pipeline.retentionPolicyResolver?.resolve("project-1")).resolves.toEqual(
        RETAINED,
      );
    });
  });
});

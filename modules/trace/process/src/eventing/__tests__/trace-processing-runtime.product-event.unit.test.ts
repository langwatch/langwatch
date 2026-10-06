import type { Project } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-projections.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createLogger: () => logger,
}));

import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";
import { createInitState, createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

type Peers = TraceProcessingPipelineInput["peers"];

function project(): Project {
  return {
    id: "project-1",
    name: "Project",
    slug: "project",
    apiKey: "legacy-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "other",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function compose() {
  const updateMetadata = vi.fn<Peers["projects"]["updateMetadata"]>(async () => undefined);
  const pipeline = TraceProcessingRuntimeAdapter.create({
    role: "worker",
    tokenizer: createApiFixture<TraceProcessingPipelineInput["tokenizer"]>(),
    peers: createApiFixture<Peers>({
      dataRetention: createApiFixture<Peers["dataRetention"]>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
      projects: createApiFixture<Peers["projects"]>({
        findById: async () => project(),
        updateMetadata,
        resolveOrgAdmin: async () => ({
          userId: "user-1",
          organizationId: "org-1",
          firstMessage: false,
          onboardingVariant: null,
          organizationCreatedAt: null,
        }),
      }),
      topics: createApiFixture<Peers["topics"]>({ bootstrapClustering: async () => undefined }),
    }),
    repositories: MemoryTraceRepositories.create(),
    canonicalisation: TraceCanonicalisationService.create(),
    commands: createApiFixture<TraceProcessingPipelineInput["commands"]>(),
    findSummary: async () => null,
    recordTrackedEvent: async () => undefined,
    broadcast: createApiFixture<TraceProcessingPipelineInput["broadcast"]>(),
    milestones: createApiFixture<TraceProcessingPipelineInput["milestones"]>({
      recordFirstTrace: async () => undefined,
      recordTraceReceived: async () => undefined,
    }),
  }).build({ participation: "consume" });
  return { pipeline, updateMetadata };
}

describe("TraceProcessingRuntimeAdapter", () => {
  describe("given no product-analytics sink is composed", () => {
    /** @scenario "A first trace on a deployment with no product-analytics sink logs no metadata failure" */
    it("marks the project integrated on its first trace and logs no metadata failure", async () => {
      const { pipeline, updateMetadata } = compose();
      const subscriber = pipeline.foldSubscribers.get("projectMetadata");
      expect(subscriber, "the pipeline registered no projectMetadata subscriber").toBeDefined();

      await subscriber?.definition.handle(createSpanReceivedEvent(), {
        tenantId: "project-1",
        aggregateId: "aaaa0000000000000000000000000001",
        foldState: createInitState(),
      });

      expect(updateMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ integrated: true }) }),
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Failed to update project metadata"),
      );
    });
  });
});

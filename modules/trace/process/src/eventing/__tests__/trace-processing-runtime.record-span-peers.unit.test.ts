import { createTenantId, type Command } from "@langwatch/eventing";
/**
 * @vitest-environment node
 * The consumer pipeline's recordSpan command and project metadata subscriber, composed
 * over the peers a process installed.
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 */
import type { ModelCost } from "@langwatch/model-provider-contract";
import type { Project } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  RECORD_SPAN_COMMAND_TYPE,
  spanReceivedEventSchema,
  type OtlpSpan,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";
import { createInitState, createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

type Peers = TraceProcessingPipelineInput["peers"];

const TENANT = "project-1";
const MODEL = "gpt-5-mini";

function ownRateFor(model: string): ModelCost {
  return {
    id: "cost-1",
    organizationId: "org-1",
    projectId: TENANT,
    scopeType: "PROJECT",
    scopeId: TENANT,
    model,
    regex: `^${model}$`,
    inputCostPerToken: 0.5,
    outputCostPerToken: 0.25,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function modelSpan(): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "chat",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes: [
      { key: "gen_ai.request.model", value: { stringValue: MODEL } },
      { key: "langwatch.input", value: { stringValue: "the customer's prompt" } },
    ],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function project(): Project {
  return {
    id: TENANT,
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

function compose({ dropsInput = false }: { dropsInput?: boolean } = {}) {
  const listCosts = vi.fn<Peers["modelProviders"]["listCosts"]>(async () => [ownRateFor(MODEL)]);
  const dropSpanContent = vi.fn<Peers["dataPrivacy"]["dropSpanContent"]>(async ({ span }) => {
    if (!dropsInput) return { droppedCount: 0, droppedCategories: [], droppedAttributeKeys: [] };
    span.attributes = span.attributes.filter((attribute) => attribute.key !== "langwatch.input");
    return { droppedCount: 1, droppedCategories: ["input"], droppedAttributeKeys: [] };
  });
  const findById = vi.fn<Peers["projects"]["findById"]>(async () => project());
  const updateMetadata = vi.fn<Peers["projects"]["updateMetadata"]>(async () => undefined);
  const recordFirstTrace = vi.fn<TraceProcessingPipelineInput["milestones"]["recordFirstTrace"]>(
    async () => undefined,
  );
  const pipeline = TraceProcessingRuntimeAdapter.create({
    processName: "langwatch-test",
    tokenizer: createApiFixture<TraceProcessingPipelineInput["tokenizer"]>({
      computeTokenCount: async () => 0,
    }),
    peers: createApiFixture<Peers>({
      dataRetention: createApiFixture<Peers["dataRetention"]>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
      dataPrivacy: createApiFixture<Peers["dataPrivacy"]>({
        redactSpan: async () => undefined,
        dropSpanContent,
      }),
      modelProviders: createApiFixture<Peers["modelProviders"]>({ listCosts }),
      featureFlags: createApiFixture<Peers["featureFlags"]>({ isEnabled: async () => false }),
      projects: createApiFixture<Peers["projects"]>({
        findById,
        updateMetadata,
        resolveOrgAdmin: async () => ({
          userId: "admin-1",
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
      recordFirstTrace,
      recordTraceReceived: async () => undefined,
    }),
  }).build({ participation: "consume" });
  return { pipeline, listCosts, dropSpanContent, findById, updateMetadata, recordFirstTrace };
}

async function foldSpanThroughRecordCommand(pipeline: ReturnType<typeof compose>["pipeline"]) {
  const sealed = pipeline.commands.find((command) => command.definition.name === "recordSpan");
  if (!sealed) throw new Error("the pipeline registered no recordSpan command");
  const data: RecordSpanCommandData = {
    tenantId: TENANT,
    span: modelSpan(),
    resource: null,
    instrumentationScope: null,
    occurredAt: 1,
  };
  const command: Command<RecordSpanCommandData> = {
    tenantId: createTenantId(TENANT),
    aggregateId: "trace-1",
    type: RECORD_SPAN_COMMAND_TYPE,
    data,
  };
  // The registration is typed over an unknown payload, so the call goes through apply.
  const emitted: unknown[] = await sealed.open(async (registration) => {
    const handler = registration.createHandler();
    return Reflect.apply(handler.handle, handler, [command]);
  });
  return spanReceivedEventSchema.parse(emitted[0]).data.span.attributes;
}

describe("the consumer pipeline composed over the installed peers", () => {
  describe("given a composed record-span command and a project with its own rates", () => {
    describe("when a span is folded through it", () => {
      /** @scenario A folded span carries the customer's rates and keeps its content */
      it("records the customer's rates and the content nobody asked to drop", async () => {
        const { pipeline, listCosts } = compose();

        const attributes = await foldSpanThroughRecordCommand(pipeline);

        expect(listCosts).toHaveBeenCalledWith({ projectId: TENANT });
        const byKey = new Map(attributes.map((attribute) => [attribute.key, attribute.value]));
        expect(byKey.get("langwatch.model.inputCostPerToken")?.doubleValue).toBe(0.5);
        expect(byKey.get("langwatch.model.outputCostPerToken")?.doubleValue).toBe(0.25);
        expect(byKey.get("langwatch.input")?.stringValue).toBe("the customer's prompt");
      });
    });
  });

  describe("given a composed record-span command and a project that drops its input", () => {
    describe("when a span is folded through it", () => {
      /** @scenario A folded span honours a stored drop policy */
      it("records the span without the dropped content, asking for the command's tenant", async () => {
        const { pipeline, dropSpanContent } = compose({ dropsInput: true });

        const attributes = await foldSpanThroughRecordCommand(pipeline);

        expect(dropSpanContent).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: TENANT }),
        );
        expect(attributes.map((attribute) => attribute.key)).not.toContain("langwatch.input");
        expect(attributes.map((attribute) => attribute.key)).toContain("gen_ai.request.model");
      });
    });
  });

  describe("given a project with no stored privacy rule", () => {
    describe("when a span passes through the content-drop port", () => {
      /** @scenario A project with no stored policy keeps its content */
      it("records the span with every attribute it arrived with", async () => {
        const { pipeline, dropSpanContent } = compose();

        const attributes = await foldSpanThroughRecordCommand(pipeline);

        expect(dropSpanContent).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: TENANT }),
        );
        expect(attributes.map((attribute) => attribute.key)).toEqual(
          expect.arrayContaining(["langwatch.input", "gen_ai.request.model"]),
        );
      });
    });
  });

  describe("given the composed capability services", () => {
    describe("when the project metadata subscriber is asked for a project, a stamp and the admin", () => {
      /** @scenario The project reads answer through the port the subscribers name */
      it("reads the project, writes the stamp and names the admin through the installed peer", async () => {
        const { pipeline, findById, updateMetadata, recordFirstTrace } = compose();
        const subscriber = pipeline.foldSubscribers.get("projectMetadata");
        expect(subscriber, "the pipeline registered no projectMetadata subscriber").toBeDefined();

        await subscriber?.definition.handle(createSpanReceivedEvent(), {
          tenantId: TENANT,
          aggregateId: "aaaa0000000000000000000000000001",
          foldState: createInitState(),
        });

        expect(findById).toHaveBeenCalledWith(TENANT);
        expect(updateMetadata).toHaveBeenCalledWith(
          expect.objectContaining({
            id: TENANT,
            data: expect.objectContaining({ integrated: true }),
          }),
        );
        expect(recordFirstTrace).toHaveBeenCalledWith(
          expect.objectContaining({ userId: "admin-1", projectId: TENANT }),
        );
      });
    });
  });
});

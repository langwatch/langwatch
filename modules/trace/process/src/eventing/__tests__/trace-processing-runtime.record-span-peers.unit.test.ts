import { createTenantId, type Command } from "@langwatch/eventing";
/**
 * @vitest-environment node
 * The consumer pipeline's recordSpan command and project metadata subscriber, composed
 * over the peers a process installed.
 * Spec: specs/trace-processing/worker-record-span-capability-services.feature
 */
import type { ModelCost } from "@langwatch/model-provider-contract";
import { type OtlpSpan } from "@langwatch/otlp/trace-request";
import type { Project } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  COMMAND_INLINE_THRESHOLD,
  RECORD_SPAN_COMMAND_TYPE,
  spanReceivedEventSchema,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceModule } from "../../app/trace.app.ts";
import { MemoryTraceLegacySpoolChannel } from "../../channels/memory/memory.trace-legacy-spool.channel.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { SPOOL_REF_V2 } from "../../features/ingestion/rules/trace-spool-location.rules.ts";
import { TraceEdgeSpoolService } from "../../features/ingestion/services/trace-edge-spool.service.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
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

function composeBlobStore(repositories: ReturnType<typeof MemoryTraceRepositories.create>) {
  return TraceModule.composeBlobStore({
    repositories,
    channels: { legacySpool: MemoryTraceLegacySpoolChannel.create() },
    config: { objectRetentionConfirmed: undefined, legacySpoolRetentionConfirmed: undefined },
  });
}

function compose({ dropsInput = false }: { dropsInput?: boolean } = {}) {
  const repositories = MemoryTraceRepositories.create();
  // The one blob store the module composes for both halves: the door writes through it, the
  // worker's record-span command reads back through it.
  const blobStore = composeBlobStore(repositories);
  const listCosts = vi.fn<Peers["modelProviders"]["listCosts"]>(async () => [ownRateFor(MODEL)]);
  const dropSpanContent = vi.fn<Peers["dataPrivacy"]["dropSpanContent"]>(async ({ span }) => {
    if (!dropsInput) return { droppedCount: 0, droppedCategories: [], droppedAttributeKeys: [] };
    span.attributes = span.attributes.filter((attribute) => attribute.key !== "langwatch.input");
    return { droppedCount: 1, droppedCategories: ["input"], droppedAttributeKeys: [] };
  });
  const redactSpan = vi.fn<Peers["dataPrivacy"]["redactSpan"]>(async () => undefined);
  const findById = vi.fn<Peers["projects"]["findById"]>(async () => project());
  const updateMetadata = vi.fn<Peers["projects"]["updateMetadata"]>(async () => undefined);
  const recordFirstTrace = vi.fn<TraceProcessingPipelineInput["milestones"]["recordFirstTrace"]>(
    async () => undefined,
  );
  const pipeline = TraceProcessingRuntimeAdapter.create({
    role: "worker",
    authorizeFoldRead: ownProofAuthorizer,
    tokenizer: createApiFixture<TraceProcessingPipelineInput["tokenizer"]>({
      computeTokenCount: async () => 0,
    }),
    peers: createApiFixture<Peers>({
      dataRetention: createApiFixture<Peers["dataRetention"]>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
      dataPrivacy: createApiFixture<Peers["dataPrivacy"]>({
        redactSpan,
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
    }),
    repositories,
    canonicalisation: TraceCanonicalisationService.create(),
    commands: createApiFixture<TraceProcessingPipelineInput["commands"]>(),
    spool: blobStore,
    findSummary: async () => null,
    recordTrackedEvent: async () => undefined,
    broadcast: createApiFixture<TraceProcessingPipelineInput["broadcast"]>(),
    milestones: createApiFixture<TraceProcessingPipelineInput["milestones"]>({
      recordFirstTrace,
      recordTraceReceived: async () => undefined,
    }),
  }).build({ participation: "consume" });
  return {
    pipeline,
    blobStore,
    repositories,
    listCosts,
    dropSpanContent,
    redactSpan,
    findById,
    updateMetadata,
    recordFirstTrace,
  };
}

function recordSpanData(span: OtlpSpan = modelSpan()): RecordSpanCommandData {
  return {
    tenantId: TENANT,
    span,
    resource: null,
    instrumentationScope: null,
    occurredAt: 1,
  };
}

async function foldSpanThroughRecordCommand(
  pipeline: ReturnType<typeof compose>["pipeline"],
  data: RecordSpanCommandData = recordSpanData(),
) {
  const sealed = pipeline.commands.find((command) => command.definition.name === "recordSpan");
  if (!sealed) throw new Error("the pipeline registered no recordSpan command");
  const command: Command<RecordSpanCommandData> = {
    tenantId: createTenantId(TENANT),
    aggregateId: "trace-1",
    type: RECORD_SPAN_COMMAND_TYPE,
    data,
  };
  // The registration is typed over an unknown payload, so the calls go through apply.
  const emitted: unknown[] = await sealed.open(async (registration) => {
    const handler = registration.createHandler();
    const events: unknown[] = await Reflect.apply(handler.handle, handler, [command]);
    // The spool object's best-effort delete. The queue runs it after storing the event; that
    // ordering is the queue's, and is not exercised here.
    const cleanup: unknown = Reflect.get(handler, "cleanupAfterStore");
    if (typeof cleanup === "function") await Reflect.apply(cleanup, handler, [command]);
    return events;
  });
  return spanReceivedEventSchema.parse(emitted[0]).data.span.attributes;
}

/** A span whose captured input alone puts its command over the inline threshold. */
function oversizedSpan(): OtlpSpan {
  const span = modelSpan();
  span.attributes = span.attributes.map((attribute) =>
    attribute.key === "langwatch.input"
      ? { key: attribute.key, value: { stringValue: "x".repeat(COMMAND_INLINE_THRESHOLD) } }
      : attribute,
  );
  return span;
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

  describe("given a trace pipeline built over the privacy and model-provider peers", () => {
    describe("when a span is folded through its record-span command", () => {
      /** @scenario The record path reads through the peers trace was installed with */
      it("redacts, drops and prices the span through those peers", async () => {
        const { pipeline, redactSpan, dropSpanContent, listCosts } = compose();

        await foldSpanThroughRecordCommand(pipeline);

        expect(redactSpan).toHaveBeenCalledOnce();
        expect(dropSpanContent).toHaveBeenCalledOnce();
        expect(listCosts).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given a trace pipeline built over the installed peers", () => {
    describe("when a span's cost rules are listed", () => {
      /** @scenario The cost rules are asked of the model-provider peer by project alone */
      it("asks the model-provider peer for the project alone and reads no project", async () => {
        const { pipeline, listCosts, findById } = compose();

        await foldSpanThroughRecordCommand(pipeline);

        expect(listCosts.mock.calls).toEqual([[{ projectId: TENANT }]]);
        expect(findById).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a privacy peer whose policy for the project drops the input category", () => {
    describe("when a span passes through the record-span command", () => {
      /** @scenario A customer's drop is honoured from the privacy peer's answer */
      it("asks the privacy peer about that span and records it without the prompt", async () => {
        const { pipeline, dropSpanContent } = compose({ dropsInput: true });

        const attributes = await foldSpanThroughRecordCommand(pipeline);

        const asked = dropSpanContent.mock.calls[0]?.[0];
        expect(asked?.projectId).toBe(TENANT);
        expect(asked?.span.spanId).toBe("span-1");
        expect(attributes.map((attribute) => attribute.key)).not.toContain("langwatch.input");
      });
    });
  });

  describe("given a model-provider peer holding the project's own rate", () => {
    describe("when the span passes through the record-span command", () => {
      /** @scenario A customer's own rate prices the span */
      it("stamps the customer's input and output rates on the span", async () => {
        const { pipeline } = compose();

        const attributes = await foldSpanThroughRecordCommand(pipeline);

        const byKey = new Map(attributes.map((attribute) => [attribute.key, attribute.value]));
        expect(byKey.get("langwatch.model.inputCostPerToken")?.doubleValue).toBe(0.5);
        expect(byKey.get("langwatch.model.outputCostPerToken")?.doubleValue).toBe(0.25);
      });
    });
  });

  describe("given a composed record-span command", () => {
    describe("when a span is folded through it", () => {
      /** @scenario The fold reads the tenant's own project and nothing wider */
      it("names the command's tenant on every privacy and cost read", async () => {
        const { pipeline, redactSpan, dropSpanContent, listCosts } = compose();

        await foldSpanThroughRecordCommand(pipeline);

        expect(redactSpan.mock.calls.map(([input]) => input.tenantId)).toEqual([TENANT]);
        expect(dropSpanContent.mock.calls.map(([input]) => input.projectId)).toEqual([TENANT]);
        expect(listCosts.mock.calls.map(([input]) => input.projectId)).toEqual([TENANT]);
      });
    });
  });

  describe("given the ingestion door spooled an over-threshold span through the module's blob store", () => {
    describe("when the worker folds the spooled command", () => {
      /** @scenario A spooled span is read back from the spool the door wrote it to */
      it("records the span with the attributes the door spooled, then removes the object", async () => {
        const { pipeline, blobStore, repositories } = compose();
        const { logger, lines } = createTestLogger();
        const door = TraceEdgeSpoolService.create({ spool: blobStore, logger });

        const queued = await door.prepare(recordSpanData(oversizedSpan()));

        expect(
          lines.findLine("warn", "oversize protection skipped; queue carries full payload"),
        ).toBeUndefined();
        expect(queued.spoolRef).toBe(SPOOL_REF_V2);
        expect(queued.span.attributes).toEqual([]);

        const attributes = await foldSpanThroughRecordCommand(pipeline, queued);

        const byKey = new Map(attributes.map((attribute) => [attribute.key, attribute.value]));
        expect(byKey.get("langwatch.input")?.stringValue).toHaveLength(COMMAND_INLINE_THRESHOLD);
        expect(byKey.get("gen_ai.request.model")?.stringValue).toBe(MODEL);
        await expect(
          repositories.spoolObjects.read({
            projectId: TENANT,
            key: "trace-blobs/spool/project-1/trace-1/span-1",
          }),
        ).rejects.toMatchObject({ name: "StoredObjectNotFoundError" });
      });
    });
  });

  describe("given a spooled command whose object the door wrote before this process started", () => {
    describe("when the worker folds it", () => {
      /** @scenario A spooled span is read back from the spool the door wrote it to */
      it("reads the object by the command's own ids rather than refusing the reference", async () => {
        const { pipeline, repositories } = compose();
        // A blob store of its own, as the previous process had, over the same object storage.
        const previousProcess = composeBlobStore(repositories);
        const full = recordSpanData(oversizedSpan());
        await previousProcess.putSpool({
          projectId: TENANT,
          traceId: "trace-1",
          spanId: "span-1",
          body: Buffer.from(JSON.stringify(full), "utf8"),
        });

        const attributes = await foldSpanThroughRecordCommand(pipeline, {
          ...full,
          spoolRef: SPOOL_REF_V2,
          span: { ...full.span, attributes: [] },
        });

        expect(attributes.map((attribute) => attribute.key)).toContain("langwatch.input");
        await expect(
          repositories.spoolObjects.read({
            projectId: TENANT,
            key: "trace-blobs/spool/project-1/trace-1/span-1",
          }),
        ).rejects.toMatchObject({ name: "StoredObjectNotFoundError" });
      });
    });
  });
});

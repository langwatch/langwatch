import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { SPAN_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createProjectMetadataSubscriber,
  type ProjectMetadataSubscriberDeps,
} from "../projectMetadata.subscriber";

const TENANT_ID = "project-123";

function createFoldState(
  attributes: Record<string, string> = {},
): TraceSummaryData {
  return { attributes } as unknown as TraceSummaryData;
}

function createEvent(
  tenantId: string,
  aggregateId = "trace-1",
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId,
    aggregateType: "trace",
    tenantId,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {},
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: aggregateId },
  } as unknown as TraceProcessingEvent;
}

function createContext(
  state: TraceSummaryData,
): TriggerContext<TraceSummaryData> {
  return { tenantId: TENANT_ID, aggregateId: "trace-1", state };
}

function createMockProjectService() {
  return {
    getById: vi.fn(),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    repo: {} as any,
  };
}

describe("projectMetadata subscriber", () => {
  let deps: ProjectMetadataSubscriberDeps;
  let projects: ReturnType<typeof createMockProjectService>;

  const run = (state: TraceSummaryData) =>
    createProjectMetadataSubscriber(deps).spec.handler(
      createEvent(TENANT_ID),
      createContext(state),
    );

  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
    projects = createMockProjectService();
    deps = { projects: projects as any };
    projects.getById.mockResolvedValue({
      id: TENANT_ID,
      firstMessage: false,
      integrated: false,
    });
    projects.updateMetadata.mockResolvedValue(undefined);
  });

  describe("given a project receiving its first real trace", () => {
    /** @scenario "Project marks as integrated after first trace ingestion" */
    it("marks the project as having received a message", async () => {
      await run(createFoldState());

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ firstMessage: true, integrated: true }),
      });
    });

    it("detects the SDK language from the trace's attributes", async () => {
      await run(createFoldState({ "sdk.language": "python" }));

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ language: "python" }),
      });
    });
  });

  describe("given an optimization studio trace", () => {
    it("leaves the integration flag alone", async () => {
      await run(createFoldState({ "langwatch.platform": "optimization_studio" }));

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ integrated: false, language: "other" }),
      });
    });
  });

  describe("given a sample trace", () => {
    it("leaves the onboarding card up", async () => {
      // Seeded sample traces are not a real integration; flipping the flags
      // would dismiss the empty state before the user connected anything.
      await run(createFoldState({ "langwatch.origin": "sample" }));

      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("given a project that is already marked", () => {
    beforeEach(() => {
      projects.getById.mockResolvedValue({
        id: TENANT_ID,
        firstMessage: true,
        integrated: true,
      });
    });

    it("writes nothing", async () => {
      await run(createFoldState());

      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when the project cannot be read", () => {
    it("writes nothing and does not throw", async () => {
      projects.getById.mockResolvedValue(null);

      await expect(run(createFoldState())).resolves.toBeUndefined();
      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when the metadata write fails", () => {
    it("does not throw, because the next trace re-asserts it", async () => {
      projects.updateMetadata.mockRejectedValue(new Error("pg down"));

      // This is what makes a subscriber the right substrate: the work is
      // level-triggered, so a lost attempt is invisible by the next ingest.
      await expect(run(createFoldState())).resolves.toBeUndefined();
    });
  });

  describe("the debounce", () => {
    it("collapses every trace in a project into one write window", async () => {
      const { spec } = createProjectMetadataSubscriber(deps);

      const first = spec.dedupId!(createEvent(TENANT_ID, "trace-1"));
      const second = spec.dedupId!(createEvent(TENANT_ID, "trace-2"));
      const other = spec.dedupId!(createEvent("project-456", "trace-3"));

      // Per project, not per trace — one database round trip per window
      // however many traces land in it.
      expect(first).toBe(second);
      expect(other).not.toBe(first);
    });
  });
});

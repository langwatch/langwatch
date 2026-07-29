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

import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createProjectMetadataSubscriber,
  type ProjectMetadataSubscriberDeps,
} from "../projectMetadata.subscriber";
import {
  createMockProjectService,
  originResolvedEvent,
  spanEvent,
  subscriberContext,
  TENANT_ID,
} from "./support/ingestEventFixtures";

describe("projectMetadata subscriber", () => {
  let deps: ProjectMetadataSubscriberDeps;
  let projects: ReturnType<typeof createMockProjectService>;

  const run = (event: TraceProcessingEvent = spanEvent()) =>
    createProjectMetadataSubscriber(deps).handle(event, subscriberContext());

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

  describe("given the subscriber is built", () => {
    it("listens on the events that carry a project's ingest signals", () => {
      const subscriber = createProjectMetadataSubscriber(deps);

      expect(subscriber.eventTypes).toEqual([
        "lw.obs.trace.span_received",
        "lw.obs.trace.origin_resolved",
      ]);
    });

    it("declines a seeded sample trace before a job is ever staged", () => {
      // The one honest event-only gate this subscriber has (ADR-069 invariant
      // 4). It is legal at the retry-less routing seam only because the signal
      // read is three single-key OTLP lookups, not a normalization.
      const filter =
        createProjectMetadataSubscriber(deps).options?.enqueue?.filter;

      expect(
        filter?.(
          spanEvent({ spanAttributes: { "langwatch.origin": "sample" } }),
        ),
      ).toBe(false);
      expect(filter?.(spanEvent())).toBe(true);
    });

    it("keeps the filter total against a span it cannot make sense of", () => {
      // A throw here loses this subscriber's job for this event permanently.
      const filter =
        createProjectMetadataSubscriber(deps).options?.enqueue?.filter;
      const malformed = {
        ...spanEvent(),
        data: { span: "not-an-object", resource: 7 },
      } as unknown as TraceProcessingEvent;

      expect(() => filter?.(malformed)).not.toThrow();
      expect(filter?.(malformed)).toBe(true);
    });
  });

  describe("given a project receiving its first real trace", () => {
    /** @scenario "Project marks as integrated after first trace ingestion" */
    it("marks the project as having received a message", async () => {
      await run();

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ firstMessage: true, integrated: true }),
      });
    });

    it("detects the SDK language from the event's own resource attributes", async () => {
      await run(
        spanEvent({
          resourceAttributes: { "telemetry.sdk.language": "python" },
        }),
      );

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ language: "python" }),
      });
    });

    it("records typescript the same way", async () => {
      await run(
        spanEvent({
          resourceAttributes: { "telemetry.sdk.language": "typescript" },
        }),
      );

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ language: "typescript" }),
      });
    });

    it("falls back to other for an SDK it does not recognise", async () => {
      await run(
        spanEvent({ resourceAttributes: { "telemetry.sdk.language": "go" } }),
      );

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ language: "other" }),
      });
    });
  });

  describe("given an optimization studio trace", () => {
    it("leaves the integration flag alone", async () => {
      await run(
        spanEvent({
          resourceAttributes: { "langwatch.platform": "optimization_studio" },
        }),
      );

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
      await run(
        spanEvent({ spanAttributes: { "langwatch.origin": "sample" } }),
      );

      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });

    it("recognises the sample marker on the resource too", async () => {
      // The ingest-key provenance stamp writes the origin onto the resource so
      // an upstream payload cannot forge a different one per span.
      await run(
        spanEvent({ resourceAttributes: { "langwatch.origin": "sample" } }),
      );

      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });

    it("does not read the project at all", async () => {
      await run(
        spanEvent({ spanAttributes: { "langwatch.origin": "sample" } }),
      );

      expect(projects.getById).not.toHaveBeenCalled();
    });
  });

  describe("given a trace whose origin was resolved later", () => {
    it("marks the project from the origin_resolved event alone", async () => {
      // The deferred-origin path carries no resource, so it can only answer
      // "is this a sample" — which is all the guard asks.
      await run(originResolvedEvent({ origin: "application" }));

      expect(projects.updateMetadata).toHaveBeenCalledWith({
        id: TENANT_ID,
        data: expect.objectContaining({ firstMessage: true, integrated: true }),
      });
    });

    it("still skips a trace resolved as a sample", async () => {
      await run(originResolvedEvent({ origin: "sample" }));

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
      await run();

      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when the project cannot be read", () => {
    it("writes nothing and does not throw", async () => {
      projects.getById.mockResolvedValue(null);

      await expect(run()).resolves.toBeUndefined();
      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when the metadata write fails", () => {
    it("does not throw, because the next trace re-asserts it", async () => {
      projects.updateMetadata.mockRejectedValue(new Error("pg down"));

      // This is what makes a subscriber the right substrate: the work is
      // level-triggered, so a lost attempt is invisible by the next ingest.
      await expect(run()).resolves.toBeUndefined();
    });
  });

  describe("the debounce", () => {
    const dedupOf = () => {
      const dedup =
        createProjectMetadataSubscriber(deps).options?.deduplication;
      if (typeof dedup !== "object") {
        throw new Error("expected a deduplication config");
      }
      return dedup;
    };

    it("collapses every trace in a project into one write window", async () => {
      const dedup = dedupOf();

      const first = dedup.makeId(spanEvent({ traceId: "trace-1" }));
      const second = dedup.makeId(spanEvent({ traceId: "trace-2" }));
      const other = dedup.makeId(
        spanEvent({ tenantId: "project-456", traceId: "trace-3" }),
      );

      // Per project, not per trace — one database round trip per window
      // however many traces land in it.
      expect(first).toBe(second);
      expect(other).not.toBe(first);
    });

    it("groups a project's traces together, so the window has something to collapse", () => {
      // The queue can only squash a duplicate staged in the same group. On the
      // default per-trace group a project ingesting two traces at once deleted
      // and re-staged its own dedup key, so the window collapsed nothing.
      const groupKeyFn =
        createProjectMetadataSubscriber(deps).options?.groupKeyFn;

      expect(groupKeyFn?.(spanEvent({ traceId: "trace-1" }))).toBe(
        groupKeyFn?.(spanEvent({ traceId: "trace-2" })),
      );
    });

    it("holds the window open past dispatch, so it is a rate bound and not an accident", () => {
      // Without this a key whose job already dispatched reads as stale, and a
      // project that keeps up with its own ingest pays a round trip per span.
      const dedup = dedupOf();

      expect(dedup.shouldSurviveDispatch).toBe(true);
      expect(dedup.extend).toBe(false);
    });

    it("never collapses a span into a deferred origin resolution", () => {
      // An origin_resolved carries no resource, so a window it won would write
      // `language: "other"` over a project whose spans said python.
      const dedup = dedupOf();

      expect(dedup.makeId(spanEvent())).not.toBe(
        dedup.makeId(originResolvedEvent({ origin: "application" })),
      );
    });
  });
});

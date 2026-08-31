import { describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { buildTraceDeps } from "../../core/support/traceProcessingFixtures";
import { createTraceProcessingPipeline } from "~/runtime/app/trace-processing.adapter";
import { ProjectMetadataSync } from "@langwatch/trace-server";

/**
 * The lane and the dedup id must describe the same unit of work. The queue
 * only squashes a duplicate when the dedup key's existing job is found in the
 * group being staged into, so a per-project dedup id under a per-trace lane
 * never collapses anything — it leaves one live job per concurrent trace and
 * deletes the guard on the job already pending elsewhere.
 */
describe("ProjectMetadataSync.projectMetadataGroupKey", () => {
  describe("given two events for the same project", () => {
    describe("when they come from different traces", () => {
      it("routes them to the same lane", () => {
        expect(ProjectMetadataSync.projectMetadataGroupKey({ tenantId: "project_x" })).toBe(
          ProjectMetadataSync.projectMetadataGroupKey({ tenantId: "project_x" }),
        );
      });
    });
  });

  describe("given events for different projects", () => {
    it("routes them to different lanes", () => {
      expect(ProjectMetadataSync.projectMetadataGroupKey({ tenantId: "project_x" })).not.toBe(
        ProjectMetadataSync.projectMetadataGroupKey({ tenantId: "project_y" }),
      );
    });
  });

  it("keys the lane on the project alone", () => {
    expect(ProjectMetadataSync.projectMetadataGroupKey({ tenantId: "project_x" })).toBe(
      "project-metadata:project_x",
    );
  });
});

describe("projectMetadata lane wiring", () => {
  const pipeline = createTraceProcessingPipeline(buildTraceDeps());
  const registration = pipeline.foldSubscribers.get("projectMetadata")!.definition;

  function payloadFor({ tenantId, aggregateId }: { tenantId: string; aggregateId: string }) {
    return {
      event: { tenantId, aggregateId, aggregateType: "trace" },
      foldState: {},
    } as unknown as Parameters<
      NonNullable<NonNullable<typeof registration.options>["groupKeyFn"]>
    >[0];
  }

  describe("given a project ingesting several traces at once", () => {
    describe("when each trace dispatches the subscriber", () => {
      it("assigns every dispatch the same lane", () => {
        const groupKeyFn = registration.options?.groupKeyFn;
        expect(groupKeyFn).toBeDefined();

        const lanes = ["trace_1", "trace_2", "trace_3"].map((aggregateId) =>
          groupKeyFn!(payloadFor({ tenantId: "project_x", aggregateId })),
        );

        expect(new Set(lanes).size).toBe(1);
      });

      it("assigns every dispatch the same dedup id", () => {
        const makeJobId = registration.options?.makeJobId;
        expect(makeJobId).toBeDefined();

        const jobIds = ["trace_1", "trace_2", "trace_3"].map((aggregateId) =>
          makeJobId!(payloadFor({ tenantId: "project_x", aggregateId })),
        );

        expect(new Set(jobIds).size).toBe(1);
      });
    });
  });

  describe("given two projects ingesting concurrently", () => {
    it("keeps their lanes separate so one project cannot serialize behind another", () => {
      const groupKeyFn = registration.options!.groupKeyFn!;

      expect(groupKeyFn(payloadFor({ tenantId: "project_x", aggregateId: "t1" }))).not.toBe(
        groupKeyFn(payloadFor({ tenantId: "project_y", aggregateId: "t1" })),
      );
    });
  });

  describe("given the lane and the dedup id are both derived from a payload", () => {
    it("varies them over exactly the same inputs", () => {
      const groupKeyFn = registration.options!.groupKeyFn!;
      const makeJobId = registration.options!.makeJobId!;

      const sameProjectDifferentTrace = [
        payloadFor({ tenantId: "project_x", aggregateId: "trace_1" }),
        payloadFor({ tenantId: "project_x", aggregateId: "trace_2" }),
      ] as const;
      const differentProject = payloadFor({
        tenantId: "project_y",
        aggregateId: "trace_1",
      });

      // Both collapse across traces...
      expect(groupKeyFn(sameProjectDifferentTrace[0])).toBe(
        groupKeyFn(sameProjectDifferentTrace[1]),
      );
      expect(makeJobId(sameProjectDifferentTrace[0])).toBe(makeJobId(sameProjectDifferentTrace[1]));

      // ...and both split across projects.
      expect(groupKeyFn(sameProjectDifferentTrace[0])).not.toBe(groupKeyFn(differentProject));
      expect(makeJobId(sameProjectDifferentTrace[0])).not.toBe(makeJobId(differentProject));
    });
  });
});

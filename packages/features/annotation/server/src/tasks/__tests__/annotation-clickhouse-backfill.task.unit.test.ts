import { describe, expect, it, vi } from "vitest";
import {
  AnnotationBackfillSourcePort,
  TraceAnnotationSyncPort,
  type BackfillableAnnotation,
} from "../../ports/annotation-backfill.port";
import { AnnotationBackfillSweep } from "../annotation-clickhouse-backfill.task";

class FakeSource extends AnnotationBackfillSourcePort {
  constructor(private readonly byProject: Record<string, BackfillableAnnotation[]>) {
    super();
  }
  listProjectIds(): Promise<readonly string[]> {
    return Promise.resolve(Object.keys(this.byProject));
  }
  listAnnotations({
    projectId,
  }: {
    projectId: string;
  }): Promise<readonly BackfillableAnnotation[]> {
    return Promise.resolve(this.byProject[projectId] ?? []);
  }
}

class RecordingSync extends TraceAnnotationSyncPort {
  readonly bulkSyncAnnotations = vi.fn(() => Promise.resolve());
}

describe("given annotations that ClickHouse has drifted from", () => {
  describe("when the backfill runs", () => {
    it("sends one bulk sync per trace, carrying every annotation on it", async () => {
      const sync = new RecordingSync();

      const totals = await AnnotationBackfillSweep.create({
        source: new FakeSource({
          "project-1": [
            { id: "annotation-1", traceId: "trace-a" },
            { id: "annotation-2", traceId: "trace-a" },
            { id: "annotation-3", traceId: "trace-b" },
          ],
        }),
        sync,
        now: () => 1_700_000_000_000,
      }).execute();

      expect(sync.bulkSyncAnnotations).toHaveBeenNthCalledWith(1, {
        tenantId: "project-1",
        traceId: "trace-a",
        annotationIds: ["annotation-1", "annotation-2"],
        occurredAt: 1_700_000_000_000,
      });
      expect(sync.bulkSyncAnnotations).toHaveBeenNthCalledWith(2, {
        tenantId: "project-1",
        traceId: "trace-b",
        annotationIds: ["annotation-3"],
        occurredAt: 1_700_000_000_000,
      });
      expect(totals).toEqual({ projects: 1, annotations: 3, traces: 2 });
    });

    it("names each project in its own read, because the tenancy guard requires it", async () => {
      const listAnnotations = vi.fn(() => Promise.resolve([]));
      class SpyingSource extends AnnotationBackfillSourcePort {
        listProjectIds = () => Promise.resolve(["project-1", "project-2"]);
        listAnnotations = listAnnotations;
      }

      await AnnotationBackfillSweep.create({
        source: new SpyingSource(),
        sync: new RecordingSync(),
      }).execute();

      expect(listAnnotations).toHaveBeenNthCalledWith(1, { projectId: "project-1" });
      expect(listAnnotations).toHaveBeenNthCalledWith(2, { projectId: "project-2" });
    });
  });

  describe("when one trace's sync fails", () => {
    it("finishes the rest and leaves the failure out of the closed count", async () => {
      class FailingSync extends TraceAnnotationSyncPort {
        bulkSyncAnnotations = vi.fn(({ traceId }: { traceId: string }) =>
          traceId === "trace-a"
            ? Promise.reject(new Error("clickhouse refused"))
            : Promise.resolve(),
        );
      }
      const sync = new FailingSync();

      const totals = await AnnotationBackfillSweep.create({
        source: new FakeSource({
          "project-1": [
            { id: "annotation-1", traceId: "trace-a" },
            { id: "annotation-2", traceId: "trace-b" },
          ],
        }),
        sync,
      }).execute();

      expect(sync.bulkSyncAnnotations).toHaveBeenCalledTimes(2);
      expect(totals).toEqual({ projects: 1, annotations: 2, traces: 1 });
    });
  });
});

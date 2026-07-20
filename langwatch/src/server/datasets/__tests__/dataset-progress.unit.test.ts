import { afterEach, describe, expect, it } from "vitest";
import { BroadcastService } from "../../app-layer/broadcast/broadcast.service";
import {
  DATASET_PROGRESS_EVENT,
  datasetProgressEventSchema,
  makeEmitDatasetProgress,
} from "../dataset-progress";

/**
 * ADR-034: the progress broadcast wire, end to end through a REAL
 * `BroadcastService` (no Redis → local emit). Proves the three things a browser
 * pass would otherwise have to: the event-type name matches what the emitter
 * delivers, the payload round-trips through JSON, and `datasetProgressEventSchema`
 * accepts it — for both the rate-limited progress path and the plain terminal
 * path (Decision 5).
 */

const flush = () => new Promise((resolve) => setImmediate(resolve));

let broadcast: BroadcastService;

afterEach(async () => {
  await broadcast.close();
});

describe("dataset progress broadcast wire", () => {
  const collect = (projectId: string) => {
    const received: { event: string }[] = [];
    broadcast
      .getTenantEmitter(projectId)
      .on(DATASET_PROGRESS_EVENT, (data: { event: string }) =>
        received.push(data),
      );
    return received;
  };

  describe("when a progress tick is emitted", () => {
    it("delivers a schema-valid event to the project's tenant emitter", async () => {
      broadcast = new BroadcastService(null);
      const received = collect("project_p1");
      const emit = makeEmitDatasetProgress(broadcast);

      emit("project_p1", {
        datasetId: "d1",
        type: "progress",
        phase: "processing",
        bytesRead: 512,
        totalBytes: 1024,
        rows: 7,
      });
      await flush();

      expect(received).toHaveLength(1);
      const parsed = datasetProgressEventSchema.parse(
        JSON.parse(received[0]!.event),
      );
      expect(parsed).toMatchObject({
        datasetId: "d1",
        type: "progress",
        bytesRead: 512,
        totalBytes: 1024,
        rows: 7,
      });
    });
  });

  describe("when a terminal event is emitted", () => {
    it("delivers the done event (plain path) to the tenant emitter", async () => {
      broadcast = new BroadcastService(null);
      const received = collect("project_p1");
      const emit = makeEmitDatasetProgress(broadcast);

      emit("project_p1", { datasetId: "d1", type: "done", phase: "ready" });
      await flush();

      const parsed = datasetProgressEventSchema.parse(
        JSON.parse(received.at(-1)!.event),
      );
      expect(parsed).toMatchObject({ datasetId: "d1", type: "done" });
    });
  });

  describe("when a tick targets another project", () => {
    it("is not delivered to this project's emitter (tenant isolation)", async () => {
      broadcast = new BroadcastService(null);
      const mine = collect("project_p1");
      const emit = makeEmitDatasetProgress(broadcast);

      emit("project_p2", { datasetId: "dX", type: "progress", bytesRead: 1 });
      await flush();

      expect(mine).toHaveLength(0);
    });
  });
});

/**
 * The export progress relay over a real emitter, as the broadcast fabric emits it.
 * @see modules/trace/specs/export-progress.feature
 */
import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { TraceExportProgressService } from "../trace-export-progress.service.ts";

const PROJECT_ID = "project-1";

function relay() {
  const emitter = new EventEmitter();
  const cleanupTenantEmitter = vi.fn();
  const service = TraceExportProgressService.create({
    broadcast: { getTenantEmitter: () => emitter, cleanupTenantEmitter },
  });
  const emit = (event: unknown) =>
    emitter.emit("export_progress", { event: JSON.stringify(event), timestamp: 1 });
  const emitRaw = (event: string) => emitter.emit("export_progress", { event, timestamp: 1 });

  return { emitter, service, emit, emitRaw, cleanupTenantEmitter };
}

async function collect(stream: AsyncGenerator<unknown>): Promise<unknown[]> {
  const frames: unknown[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

describe("TraceExportProgressService", () => {
  describe("given two exports running in the same project", () => {
    /** @scenario "A viewer sees only the progress of the export they started" */
    it("relays only the watched export's frames", async () => {
      const { service, emit } = relay();
      const frames = collect(service.stream({ projectId: PROJECT_ID, exportId: "mine" }));
      await Promise.resolve();

      emit({ exportId: "theirs", type: "progress", exported: 1, total: 9 });
      emit({ exportId: "mine", type: "progress", exported: 2, total: 4 });
      emit({ exportId: "theirs", type: "done" });
      emit({ exportId: "mine", type: "done", exported: 4, total: 4 });

      expect(await frames).toEqual([
        { exportId: "mine", type: "progress", exported: 2, total: 4 },
        { exportId: "mine", type: "done", exported: 4, total: 4 },
      ]);
    });
  });

  describe("given a viewer watching an export", () => {
    /** @scenario "The progress stream ends when the export finishes or fails" */
    it.each(["done", "error"] as const)("delivers the %s frame and ends", async (type) => {
      const { service, emit } = relay();
      const frames = collect(service.stream({ projectId: PROJECT_ID, exportId: "e-1" }));
      await Promise.resolve();

      emit({ exportId: "e-1", type, message: "finished" });
      emit({ exportId: "e-1", type: "progress", exported: 99 });

      expect(await frames).toEqual([{ exportId: "e-1", type, message: "finished" }]);
    });

    /** @scenario "An unreadable progress frame is skipped" */
    it("skips a frame that is not a progress event and relays the next", async () => {
      const { service, emit, emitRaw } = relay();
      const frames = collect(service.stream({ projectId: PROJECT_ID, exportId: "e-1" }));
      await Promise.resolve();

      emitRaw("{not json");
      emit({ exportId: "e-1", type: "unknown-kind" });
      emit({ exportId: "e-1", type: "done" });

      expect(await frames).toEqual([{ exportId: "e-1", type: "done" }]);
    });

    /** @scenario "Watching an export releases the project's broadcast when it ends" */
    it("releases the project's emitter once the stream ends", async () => {
      const { service, emit, cleanupTenantEmitter } = relay();
      const frames = collect(service.stream({ projectId: PROJECT_ID, exportId: "e-1" }));
      await Promise.resolve();

      emit({ exportId: "e-1", type: "done" });
      await frames;

      expect(cleanupTenantEmitter).toHaveBeenCalledWith(PROJECT_ID);
    });
  });
});

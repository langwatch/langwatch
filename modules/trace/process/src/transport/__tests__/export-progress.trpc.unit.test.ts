/**
 * @vitest-environment node
 * `export.*` at main's names, bodies and permissions.
 * @see modules/trace/specs/export-progress.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { exportTrpc, type ExportProgressEvent, type TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { exportProgressTrpcTransport } from "../export-progress.trpc.ts";
import { accessDeclaredBy, createTestTrpcRuntime } from "./support/trpc-harness.ts";

const FRAMES: ExportProgressEvent[] = [
  { exportId: "export-1", type: "progress", exported: 5, total: 10 },
  { exportId: "export-1", type: "done", exported: 10, total: 10 },
];

function harness() {
  const streamExportProgress = vi.fn<TraceApi["streamExportProgress"]>(async function* () {
    yield* FRAMES;
  });
  const app = createApiFixture<TraceApi>({ streamExportProgress });
  const router = createTestTrpcRuntime().mount(exportProgressTrpcTransport, () => app);

  return { caller: router.createCaller({ actor: { id: "viewer-1" } }), streamExportProgress };
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const frames: unknown[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

describe("given the export namespace", () => {
  it("answers under main's namespace with main's two subscriptions", () => {
    expect(exportTrpc.namespace).toBe("export");
    expect(Object.entries(exportTrpc.members).map(([name, m]) => [name, m.kind])).toEqual([
      ["onExportProgress", "subscription"],
      ["onScenarioRunExportProgress", "subscription"],
    ]);
  });

  /** @scenario "Trace and scenario run exports are watched under their own permissions" */
  it("asks for traces:view and scenarios:view respectively", () => {
    expect(accessDeclaredBy(exportProgressTrpcTransport)).toEqual({
      "export.onExportProgress": "traces:view",
      "export.onScenarioRunExportProgress": "scenarios:view",
    });
  });
});

describe("when a viewer subscribes to an export's progress", () => {
  /** @scenario "Both export doors relay the watched export's frames" */
  it.each(["onExportProgress", "onScenarioRunExportProgress"] as const)(
    "relays the stream's frames through %s",
    async (door) => {
      const { caller, streamExportProgress } = harness();

      const frames = await drain(await caller[door]({ projectId: "p-1", exportId: "export-1" }));

      expect(frames).toEqual(FRAMES);
      expect(streamExportProgress).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "p-1", exportId: "export-1" }),
      );
    },
  );
});

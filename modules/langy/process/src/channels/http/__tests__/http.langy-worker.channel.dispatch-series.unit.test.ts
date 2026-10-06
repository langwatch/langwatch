/**
 * @vitest-environment node
 * @see specs/langy/worker-langy-conversation-conversion.feature
 */
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpLangyWorkerChannel } from "../../../index.ts";
import { LangyWorkerMetricsOtelService } from "../../../services/langy-worker-metrics-otel.service.ts";

const SERIES = "langwatch_langy_dispatch_total";

const dispatchInput = {
  intent: "continue" as const,
  conversationId: "conversation-1",
  turnId: "turn-1",
  projectId: "project-1",
  userId: "user-1",
  runToken: "run-token",
  prompt: "hello",
  system: "system",
  credentials: { llmVirtualKey: "key" },
};

describe("the langy dispatch series", () => {
  let meter = createRecordingMeterProvider();

  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
  });

  afterEach(() => {
    meter.uninstall();
    vi.unstubAllGlobals();
  });

  describe("when the worker port dispatches a turn the agent manager answers", () => {
    /** @scenario "The worker publishes the Langy dispatch series" */
    it.each([
      [200, "accepted"],
      [409, "busy"],
      [503, "unavailable"],
    ] as const)("counts a %s answer under the %s outcome", async (status, outcome) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
      );
      const worker = HttpLangyWorkerChannel.create({
        agentUrl: "http://agent",
        internalSecret: "secret",
        metrics: LangyWorkerMetricsOtelService.create(),
      });

      await worker.dispatch(dispatchInput);

      expect(meter.valueOf(SERIES, { outcome })).toBe(1);
      expect(meter.valueOf(SERIES)).toBe(1);
    });
  });
});

/**
 * @vitest-environment node
 * Spec: specs/trace-processing/worker-trace-pipeline-conversion.feature
 */
import type { PresenceApi } from "@langwatch/presence-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { createSpanStorageBroadcastHandler } from "../span-storage-broadcast.subscriber.ts";
import { createTraceUpdateBroadcastHandler } from "../trace-update-broadcast.subscriber.ts";
import {
  TENANT_ID,
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

describe("the two broadcast subscribers", () => {
  describe("given a trace update and a span storage event", () => {
    describe("when each reaches its broadcast subscriber", () => {
      /** @scenario Both broadcast subscribers publish through one bridge */
      it("publishes both through the one tenant bridge they were handed", async () => {
        const publishProjectEvent = vi.fn<PresenceApi["publishProjectEvent"]>(
          async () => undefined,
        );
        const broadcast = createApiFixture<Pick<PresenceApi, "publishProjectEvent">>({
          publishProjectEvent,
        });
        const context = createContext(createFoldState());

        await createTraceUpdateBroadcastHandler({ broadcast })(
          createSpanReceivedEvent(createOtlpSpan()),
          context,
        );
        await createSpanStorageBroadcastHandler({ broadcast })(
          createSpanReceivedEvent(createOtlpSpan()),
          context,
        );

        expect(publishProjectEvent).toHaveBeenCalledTimes(2);
        const events = publishProjectEvent.mock.calls.map(([call]) => ({
          projectId: call.projectId,
          event: JSON.parse(String(call.event)).event,
        }));
        expect(events).toEqual([
          { projectId: TENANT_ID, event: "trace_summary_updated" },
          { projectId: TENANT_ID, event: "span_stored" },
        ]);
      });
    });
  });
});

/**
 * The relay reads its ndjson frame stream line by line as chunks arrive.
 * @see specs/langy/langy-dual-stream.feature
 */
import type { LangyRelayConnection } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { LangyInternalService } from "../langy-internal.service.ts";
import type { LangyRestMetrics } from "../langy-rest-metrics-prometheus.service.ts";
import type { LangyService } from "../langy.service.ts";

const encoder = new TextEncoder();

function relayOver(handled: unknown[], onHandle: () => void = () => void 0) {
  const relay: LangyRelayConnection = {
    pinnedTurn: null,
    handle: vi.fn(async (raw: unknown) => {
      handled.push(raw);
      onHandle();
      return { status: "applied" as const };
    }),
  };
  const metrics: LangyRestMetrics = {
    internal: { turnResult: vi.fn(), sessionKeyRevokeRefused: vi.fn() },
    relayFrames: { frames: vi.fn() },
  };
  return LangyInternalService.create(
    createApiFixture<LangyService>({ openRelayConnection: () => relay }),
    metrics,
  );
}

describe("LangyInternalService.receiveFrames", () => {
  describe("given the worker holds an open ndjson frame connection", () => {
    /** @scenario "The relay's ndjson frames are processed as they arrive, not after the turn ends" */
    it("handles a pushed frame before the next frame is sent", async () => {
      const handled: unknown[] = [];
      let firstHandled: () => void = () => void 0;
      const firstSeen = new Promise<void>((resolve) => {
        firstHandled = resolve;
      });
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start: (c) => {
          controller = c;
        },
      });
      const service = relayOver(handled, () => firstHandled());

      const tally = service.receiveFrames(body);
      controller?.enqueue(encoder.encode('{"seq":1}\n'));
      await firstSeen;

      expect(handled).toEqual([{ seq: 1 }]);

      controller?.enqueue(encoder.encode('{"seq":2}\n'));
      controller?.close();

      expect(await tally).toEqual({ applied: 2, duplicate: 0, rejected: 0, terminal: false });
      expect(handled).toEqual([{ seq: 1 }, { seq: 2 }]);
    });

    it("still delivers a whole non-streaming body, final line without a newline included", async () => {
      const handled: unknown[] = [];
      const service = relayOver(handled);

      const tally = await service.receiveFrames(new Response('{"seq":1}\n{"seq":2}').body);

      expect(tally).toEqual({ applied: 2, duplicate: 0, rejected: 0, terminal: false });
      expect(handled).toEqual([{ seq: 1 }, { seq: 2 }]);
    });
  });
});

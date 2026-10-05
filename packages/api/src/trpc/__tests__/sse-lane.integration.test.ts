/** @vitest-environment node */

/**
 * Who may open the live update channel, and onto what. Spec:
 * specs/security/sse-lane-subscriptions-only.feature.
 */
import { describe, expect, it, vi } from "vitest";

import {
  LiveStreamCrossSiteBlockedError,
  LiveStreamUnsupportedProcedureError,
} from "../../errors.ts";
import { SseLane } from "../sse.ts";

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function laneOver(procedureType: "query" | "mutation" | "subscription") {
  const createCaller = vi.fn(async () => ({
    traces: {
      watch: async () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
      }),
    },
  }));

  const lane = SseLane.create({
    members: { createCaller, procedureTypeAt: () => procedureType },
    logger: silent,
  });

  return { lane, createCaller };
}

async function refusalOf(attempt: Promise<Response>): Promise<{ code: unknown }> {
  try {
    await attempt;
  } catch (failure) {
    return failure as { code: unknown };
  }

  throw new Error("the lane answered where it should have refused");
}

describe("the live update channel", () => {
  /** @scenario "A query path on the subscription lane is refused" */
  it("refuses a path that names a query rather than streaming its single result", async () => {
    const { lane, createCaller } = laneOver("query");

    const request = new Request("http://api.test/api/sse/traces/list", {
      headers: { "sec-fetch-site": "same-origin" },
    });

    const refusal = await refusalOf(lane.answer(request, new Headers()));

    expect(refusal).toBeInstanceOf(LiveStreamUnsupportedProcedureError);
    expect(createCaller).not.toHaveBeenCalled();
  });

  /** @scenario "A cross-site request cannot open the subscription lane" */
  it("refuses a cross-site navigation before any context or session is resolved", async () => {
    const { lane, createCaller } = laneOver("subscription");

    const request = new Request("http://api.test/api/sse/traces/watch", {
      headers: { "sec-fetch-site": "cross-site", cookie: "session=1" },
    });

    const refusal = await refusalOf(lane.answer(request, new Headers()));

    expect(refusal).toBeInstanceOf(LiveStreamCrossSiteBlockedError);
    expect(createCaller).not.toHaveBeenCalled();
  });

  /** @scenario "A browser that sends only an Origin still opens the channel" */
  it("opens for an Origin that matches the host it asked, when no fetch-site header is sent", async () => {
    const { lane, createCaller } = laneOver("subscription");

    const request = new Request("http://api.test/api/sse/traces/watch", {
      headers: { origin: "http://api.test", "x-forwarded-host": "api.test" },
    });

    const response = await lane.answer(request, new Headers());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(createCaller).toHaveBeenCalledTimes(1);

    await response.body?.cancel();
  });
});

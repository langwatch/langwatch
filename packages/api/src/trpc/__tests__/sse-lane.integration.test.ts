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

/** A lane over one procedure of a kind, backed by a service the test can watch. */
function laneOverServiceProcedure(procedureType: "query" | "mutation") {
  const service = vi.fn(async () => "ran");
  const createCaller = vi.fn(async () => ({ project: { rotate: service } }));

  const lane = SseLane.create({
    members: {
      createCaller,
      procedureTypeAt: (path) => (path === "project.rotate" ? procedureType : undefined),
    },
    logger: silent,
  });

  return { lane, createCaller, service };
}

function sameSiteRequest(path: string): Request {
  return new Request(`http://api.test/api/sse/${path}`, {
    headers: { "sec-fetch-site": "same-origin" },
  });
}

async function readFrames(response: Response, count: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = "";

  while (frames.length < count) {
    const { value, done } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value);

    for (let at = buffer.indexOf("\n\n"); at !== -1; at = buffer.indexOf("\n\n")) {
      frames.push(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
    }
  }

  await reader.cancel();

  return frames;
}

describe("the live update channel", () => {
  /** @scenario "A subscription path still streams" */
  it("opens for a subscription and streams the values it yields", async () => {
    const createCaller = vi.fn(async () => ({
      traces: {
        watch: async () =>
          (async function* () {
            yield { id: 1 };
            yield { id: 2 };
          })(),
      },
    }));
    const lane = SseLane.create({
      members: { createCaller, procedureTypeAt: () => "subscription" },
      logger: silent,
    });

    const response = await lane.answer(sameSiteRequest("traces/watch"), new Headers());
    const frames = await readFrames(response, 4);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(frames).toEqual([
      'data: {"type":"connected"}',
      'data: {"id":1}',
      'data: {"id":2}',
      'data: {"type":"complete"}',
    ]);
  });

  /** @scenario "A mutation path on the subscription lane is refused without running" */
  it("refuses a mutation path as unsupported on that channel and builds no caller", async () => {
    const { lane, createCaller, service } = laneOverServiceProcedure("mutation");

    const refusal = await refusalOf(lane.answer(sameSiteRequest("project/rotate"), new Headers()));

    expect(refusal).toMatchObject({ code: "live_stream_unsupported_procedure", httpStatus: 405 });
    expect(createCaller).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });

  /** @scenario "A mutation reached over the subscription lane never runs" */
  it("never calls the service behind a mutation reached over the lane", async () => {
    const { lane, service } = laneOverServiceProcedure("mutation");

    const request = new Request("http://api.test/api/sse/project/rotate?input=%7B%7D", {
      headers: { "sec-fetch-site": "same-origin", cookie: "session=1" },
    });
    const refusal = await refusalOf(lane.answer(request, new Headers()));

    expect(refusal).toMatchObject({ code: "live_stream_unsupported_procedure" });
    expect(service).not.toHaveBeenCalled();
  });

  /** @scenario "A query reached over the subscription lane never runs" */
  it("never calls the service behind a query reached over the lane", async () => {
    const { lane, createCaller, service } = laneOverServiceProcedure("query");

    const refusal = await refusalOf(lane.answer(sameSiteRequest("project/rotate"), new Headers()));

    expect(refusal).toMatchObject({ code: "live_stream_unsupported_procedure" });
    expect(createCaller).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });

  /** @scenario "An unknown subscription path is refused as not found" */
  it("refuses a path no procedure sits at as not found without resolving a caller", async () => {
    const { lane, createCaller } = laneOverServiceProcedure("query");

    const refusal = await refusalOf(lane.answer(sameSiteRequest("project/missing"), new Headers()));

    expect(refusal).toMatchObject({ code: "live_stream_not_found", httpStatus: 404 });
    expect(createCaller).not.toHaveBeenCalled();
  });

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

  /** @scenario "A request carrying no same-site signal is refused" */
  it("refuses a request with neither a fetch-site header nor an origin", async () => {
    const { lane, createCaller } = laneOver("subscription");

    const request = new Request("http://api.test/api/sse/traces/watch", {
      headers: { cookie: "session=1" },
    });

    const refusal = await refusalOf(lane.answer(request, new Headers()));

    expect(refusal).toBeInstanceOf(LiveStreamCrossSiteBlockedError);
    expect(createCaller).not.toHaveBeenCalled();
  });
});

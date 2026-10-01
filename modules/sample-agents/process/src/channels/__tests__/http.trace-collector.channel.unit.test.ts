import { describe, expect, it } from "vitest";

import {
  HttpTraceCollectorChannel,
  type TraceCollectorFetch,
} from "../http/http.trace-collector.channel.ts";

type SentRequest = Readonly<{ url: string; init: Parameters<TraceCollectorFetch>[1] }>;

function recordingFetch(status: number): { fetch: TraceCollectorFetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, init });
      return new Response(null, { status });
    },
  };
}

function sentBody(request: SentRequest | undefined): unknown {
  const body = request?.init.body;
  if (typeof body !== "string") throw new Error("the channel sent no JSON body");
  return JSON.parse(body);
}

const TRACE = { trace_id: "trace_1", spans: [] };

describe("HttpTraceCollectorChannel", () => {
  /** @scenario "The collector channel posts to this deployment's collector with the caller's key" */
  it("posts the trace to the deployment's own collector with the caller's key", async () => {
    const { fetch, sent } = recordingFetch(200);
    const channel = HttpTraceCollectorChannel.create({
      baseUrl: "https://app.langwatch.test",
      fetch,
    });

    await channel.post({ authToken: "sk-lw-project", trace: TRACE });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://app.langwatch.test/api/collector");
    expect(sent[0]?.init.method).toBe("POST");
    expect(sent[0]?.init.headers).toMatchObject({ "X-Auth-Token": "sk-lw-project" });
    expect(sentBody(sent[0])).toEqual(TRACE);
  });

  describe("given the collector answers an error status", () => {
    /** @scenario "The collector channel fails on a refused post" */
    it("fails", async () => {
      const { fetch } = recordingFetch(401);
      const channel = HttpTraceCollectorChannel.create({
        baseUrl: "https://app.langwatch.test",
        fetch,
      });

      await expect(channel.post({ authToken: "sk-lw-wrong", trace: TRACE })).rejects.toThrow("401");
    });
  });
});

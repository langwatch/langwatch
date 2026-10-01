// @vitest-environment node
import { AggregationType, MeterProvider } from "@opentelemetry/sdk-metrics";
import { describe, expect, it } from "vitest";

import { PrometheusPullReader } from "../prometheus-exposition.ts";

function readerOver(): { reader: PrometheusPullReader; provider: MeterProvider } {
  const reader = new PrometheusPullReader();
  const provider = new MeterProvider({
    views: [
      {
        instrumentName: "wait_seconds",
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: { boundaries: [1, 5], recordMinMax: true },
        },
      },
    ],
    readers: [reader],
  });
  return { reader, provider };
}

describe("the Prometheus exposition", () => {
  it("names a monotonic sum as a counter, with the _total suffix a rate() needs", async () => {
    const { reader, provider } = readerOver();
    provider.getMeter("langwatch").createCounter("jobs_done").add(3, { queue: "trace" });

    const { body, contentType } = await reader.read();

    expect(contentType).toContain("text/plain");
    expect(body).toContain("# TYPE jobs_done_total counter");
    expect(body).toContain('jobs_done_total{queue="trace"} 3');
    await provider.shutdown();
  });

  it("renders a histogram as cumulative buckets plus sum and count", async () => {
    const { reader, provider } = readerOver();
    const histogram = provider.getMeter("langwatch").createHistogram("wait_seconds");
    histogram.record(0.5);
    histogram.record(4);

    const { body } = await reader.read();

    expect(body).toContain("# TYPE wait_seconds histogram");
    expect(body).toContain('wait_seconds_bucket{le="1"} 1');
    expect(body).toContain('wait_seconds_bucket{le="5"} 2');
    expect(body).toContain('wait_seconds_bucket{le="+Inf"} 2');
    expect(body).toContain("wait_seconds_sum 4.5");
    expect(body).toContain("wait_seconds_count 2");
    await provider.shutdown();
  });

  it("escapes a label value so a quote cannot end the label set early", async () => {
    const { reader, provider } = readerOver();
    provider.getMeter("langwatch").createUpDownCounter("open_files").add(1, { path: 'a"b' });

    const { body } = await reader.read();

    expect(body).toContain("# TYPE open_files gauge");
    expect(body).toContain('open_files{path="a\\"b"} 1');
    await provider.shutdown();
  });

  it("answers an empty exposition rather than a broken one when nothing recorded", async () => {
    const { reader, provider } = readerOver();

    expect((await reader.read()).body).toBe("");
    await provider.shutdown();
  });
});

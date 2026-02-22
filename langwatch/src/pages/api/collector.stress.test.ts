import { nanoid } from "nanoid";
import { mean, median, standardDeviation } from "simple-statistics";
import { beforeAll, describe, expect, test } from "vitest";
import { esClient, TRACE_INDEX } from "../../server/elasticsearch";
import type { CollectorRESTParams } from "../../server/tracer/types";
import { getTestProject } from "../../utils/testUtils";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

const NUMBER_OF_RUNS = parseInt(process.env.NUMBER_OF_RUNS ?? "100");

describe("Collector API stress test", () => {
  let apiKey: string;

  beforeAll(async () => {
    if (!LANGWATCH_ENDPOINT.includes("localhost") || LANGWATCH_API_KEY) {
      if (!LANGWATCH_API_KEY) {
        throw new Error("LANGWATCH_API_KEY is not set");
      }
      apiKey = LANGWATCH_API_KEY;
    } else {
      const project = await getTestProject("collect");
      apiKey = project.apiKey;

      const client = await esClient({ test: true });
      await client.deleteByQuery({
        index: TRACE_INDEX.alias,
        body: {
          query: {
            match: {
              project_id: project.id,
            },
          },
        },
      });
    }
  });

  test("benchmarks 100 concurrent trace insertions", async () => {
    const makeApiCall = async (): Promise<number> => {
      const traceId = `trace_${nanoid()}`;
      const traceData: CollectorRESTParams = {
        trace_id: traceId,
        spans: [
          {
            type: "llm",
            name: "sample-span",
            span_id: `span_${nanoid()}`,
            parent_id: null,
            trace_id: traceId,
            input: {
              type: "chat_messages",
              value: [
                {
                  role: "system",
                  content: `you are a helpful assistant id ${nanoid()}`,
                },
                { role: "user", content: `hello ${nanoid()}` },
              ],
            },
            output: { type: "text", value: `world ${nanoid()}` },
            error: null,
            timestamps: {
              started_at: Date.now() - 10,
              finished_at: Date.now(),
            },
            vendor: "openai",
            model: "gpt-5",
            params: {},
            metrics: {},
          },
        ],
        metadata: {
          thread_id: "thread_test-thread_1",
          user_id: "user_test-user_1",
          customer_id: "customer_test-customer_1",
          labels: ["test-label-1.0.0"],
          my_custom_key: "my_custom_value",
        },
      };

      const startTime = Date.now();
      const response = await fetch(`${LANGWATCH_ENDPOINT}/api/collector`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": apiKey,
        },
        body: JSON.stringify(traceData),
      });
      const endTime = Date.now();

      expect(response.ok).toBe(true);
      return endTime - startTime;
    };

    const responseTimes = await Promise.all(
      Array(NUMBER_OF_RUNS)
        .fill(null)
        .map(() => makeApiCall()),
    );

    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const stats = {
      min: sortedTimes[0],
      max: sortedTimes[sortedTimes.length - 1],
      mean: mean(sortedTimes),
      median: median(sortedTimes),
      p95: sortedTimes[Math.floor(sortedTimes.length * 0.95)],
      p99: sortedTimes[Math.floor(sortedTimes.length * 0.99)],
      stdDev: standardDeviation(sortedTimes),
    };

    console.log("Benchmark results (in ms):");
    console.table(stats);
  });
});

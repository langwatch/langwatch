import { nanoid } from "nanoid";
import { mean, median, standardDeviation } from "simple-statistics";
import { beforeAll, describe, expect, test } from "vitest";

const LANGWATCH_ENDPOINT =
  process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560";

const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;

const NUMBER_OF_RUNS = parseInt(process.env.NUMBER_OF_RUNS ?? "100");

function makeOtelTraceId(): string {
  return nanoid(16)
    .split("")
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function printStats(responseTimes: number[]) {
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
}

describe("OTEL traces API stress test", () => {
  let apiKey: string;

  beforeAll(async () => {
    if (!LANGWATCH_API_KEY) {
      throw new Error("LANGWATCH_API_KEY is not set");
    }
    apiKey = LANGWATCH_API_KEY;
  });

  test(`benchmarks ${NUMBER_OF_RUNS} OTEL trace insertions`, async () => {
    const makeApiCall = async (): Promise<number> => {
      const traceIdHex = makeOtelTraceId();
      const spanIdHex = traceIdHex.slice(0, 16);
      const nowNs = `${Date.now()}000000`;

      const otelPayload = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "stress-test" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "stress-test" },
                spans: [
                  {
                    traceId: traceIdHex,
                    spanId: spanIdHex,
                    name: "llm.openai.chat",
                    kind: 3,
                    startTimeUnixNano: nowNs,
                    endTimeUnixNano: `${Date.now() + 100}000000`,
                    attributes: [
                      {
                        key: "gen_ai.system",
                        value: { stringValue: "openai" },
                      },
                      {
                        key: "gen_ai.request.model",
                        value: { stringValue: "gpt-5" },
                      },
                      {
                        key: "gen_ai.prompt.0.role",
                        value: { stringValue: "user" },
                      },
                      {
                        key: "gen_ai.prompt.0.content",
                        value: {
                          stringValue: `hello from stress test ${nanoid()}`,
                        },
                      },
                      {
                        key: "gen_ai.completion.0.role",
                        value: { stringValue: "assistant" },
                      },
                      {
                        key: "gen_ai.completion.0.content",
                        value: { stringValue: `response ${nanoid()}` },
                      },
                    ],
                    status: { code: 1 },
                  },
                ],
              },
            ],
          },
        ],
      };

      const startTime = Date.now();
      const response = await fetch(
        `${LANGWATCH_ENDPOINT}/api/otel/v1/traces`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": apiKey,
          },
          body: JSON.stringify(otelPayload),
        },
      );
      const endTime = Date.now();

      expect(response.ok).toBe(true);
      return endTime - startTime;
    };

    const responseTimes = await Promise.all(
      Array(NUMBER_OF_RUNS)
        .fill(null)
        .map(() => makeApiCall()),
    );

    printStats(responseTimes);
  });
});

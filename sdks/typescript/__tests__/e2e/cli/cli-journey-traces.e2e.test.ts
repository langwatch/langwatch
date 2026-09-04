// @vitest-environment node

/**
 * CLI journey — the trace family, over a trace this file posted itself through
 * the SDK, so the leg proves the terminal reads what an application wrote.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatch, getLangWatchTracer } from "../../../dist";
import { setupObservability } from "../../../dist/observability-sdk/setup/node";
import { cliWorkspace, parseJson, type CliWorkspace } from "./helpers";

const CLI_TIMEOUT_MS = 180_000;
const INGEST_BUDGET_MS = Number(process.env.E2E_POLL_TIMEOUT ?? "120000");
const PHRASE = "terminal reads this trace";

describe("given a trace the SDK posted", () => {
  let workspace: CliWorkspace;
  let traceId = "";

  beforeAll(async () => {
    workspace = cliWorkspace();
    const langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
    });

    const observability = setupObservability({
      langwatch: {
        apiKey: process.env.LANGWATCH_API_KEY,
        endpoint: process.env.LANGWATCH_ENDPOINT,
        processorType: "simple",
      },
      serviceName: "cli-journey",
      advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
    });

    const tracer = getLangWatchTracer("cli-journey");
    await tracer.withActiveSpan("cli-journey-span", async (span) => {
      traceId = span.spanContext().traceId;
      span.setType("llm");
      span.setInput({ message: PHRASE });
      span.setOutput({ response: "read back from the terminal" });
    });
    await observability.shutdown();

    const deadline = Date.now() + INGEST_BUDGET_MS;
    while (Date.now() < deadline) {
      const found = await langwatch.traces
        .get(traceId, { includeSpans: true })
        .catch(() => undefined);
      if (found?.spans?.length) return;
      await new Promise((done) => setTimeout(done, 2_000));
    }
    throw new Error(`the trace ${traceId} never became readable within ${INGEST_BUDGET_MS}ms`);
  }, 240_000);

  afterAll(() => {
    workspace.remove();
  });

  describe("when the trace is searched for and read from the terminal", () => {
    // @scenario "A trace posted by the SDK is found and read from the terminal"
    it("finds it in the search and prints it by id", () => {
      const search = workspace.cli.run(`trace search -q "${PHRASE}" --limit 50 -o json`);
      expect(search.exitCode ?? 0).toBe(0);
      const found = parseJson<{ traces: { trace_id: string }[] }>(search.output, "trace search");
      expect(found.traces.map((each) => each.trace_id)).toContain(traceId);

      const one = workspace.cli.run(`trace get ${traceId} -o json`);
      expect(one.exitCode ?? 0).toBe(0);
      expect(one.output).toContain(traceId);
    }, CLI_TIMEOUT_MS);
  });

  describe("when the trace's transcript is asked for", () => {
    // @scenario "A trace's transcript is read from the terminal"
    // Marked failing: GET /api/v1/traces/{traceId}/transcript is not mounted on
    // this branch, so the command cannot succeed until that route is served.
    it.fails("prints the transcript", () => {
      const result = workspace.cli.run(`trace transcript ${traceId} -o json`);

      expect(result.exitCode ?? 0).toBe(0);
      const transcript = parseJson<{ entries: unknown[] }>(result.output, "trace transcript");
      expect(Array.isArray(transcript.entries)).toBe(true);
    }, CLI_TIMEOUT_MS);
  });
});

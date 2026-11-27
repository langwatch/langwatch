/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { type TraceHeader, traceHeaderSchema } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { withBraidedTotals } from "../braided-totals.tsx";
import { MetricPill } from "../metric-pill.tsx";

afterEach(cleanup);

function ownTrace(): TraceHeader {
  return traceHeaderSchema.parse({
    traceId: "trace-1",
    timestamp: 1_700_000_000_000,
    name: "checkout conversation",
    serviceName: "svc",
    origin: "sdk",
    conversationId: null,
    userId: null,
    durationMs: 1200,
    spanCount: 4,
    status: "ok",
    models: [],
    totalCost: 0.01,
    totalTokens: 300,
    inputTokens: 200,
    outputTokens: 100,
    tokensEstimated: false,
    traceName: "checkout conversation",
    rootSpanType: null,
    scenarioRunId: null,
    attributes: {},
    braided: {
      owners: [{ projectId: "specialists", name: "Specialists", canOpen: false }],
      spanCount: 9,
      durationMs: 3400,
      cost: 0.05,
      inputTokens: 1200,
      outputTokens: 600,
    },
  });
}

describe("given a trace holding braided spans with their own cost and tokens", () => {
  /** @scenario "The trace header's totals include braided spans and say so" */
  it("shows duration, spans, cost and tokens over the whole trace", () => {
    const trace = ownTrace();
    const chips = withBraidedTotals({
      metrics: [
        { id: "duration", node: <MetricPill label="Duration" value="own duration" /> },
        { id: "models", node: <MetricPill label="Model" value="gpt-5-mini" /> },
      ],
      trace,
      braided: trace.braided!,
    });
    renderWithDesignSystem(
      <>
        {chips.map((chip) => (
          <div key={chip.id} data-testid={`metric-${chip.id}`}>
            {chip.node}
          </div>
        ))}
      </>,
    );

    expect(chips.map((chip) => chip.id)).toEqual(["duration", "models", "spans", "cost", "tokens"]);
    expect(screen.queryByText("own duration")).not.toBeInTheDocument();
    expect(screen.getByTestId("metric-spans")).toHaveTextContent("9");
    expect(screen.getByTestId("metric-tokens")).toHaveTextContent("1.2K in · 600 out");
    expect(screen.getByTestId("metric-models")).toHaveTextContent("gpt-5-mini");
  });
});

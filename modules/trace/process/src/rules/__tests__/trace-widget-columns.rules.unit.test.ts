/**
 * The span facts the stock widgets read, as the spanAnalytics projection computes them from the
 * maps stored_spans stores, and the floor the span widgets show.
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */
import { describe, expect, it } from "vitest";

import { spanAnalyticsFloorOf, spanWidgetFacts } from "../trace-widget-columns.rules.ts";

const facts = ({
  spanAttributes = {},
  resourceAttributes = {},
}: {
  spanAttributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}) => spanWidgetFacts({ spanAttributes, resourceAttributes });

describe("spanWidgetFacts", () => {
  describe("given a span with every key the widgets read", () => {
    /** @scenario "The span projection computes the five span columns" */
    it("computes the type, error, context count, input hash and environment", () => {
      const result = facts({
        spanAttributes: {
          "langwatch.span.type": "rag",
          "exception.type": "TimeoutError",
          "langwatch.rag.contexts": JSON.stringify([{ content: "a" }, { content: "b" }]),
          "langwatch.input": "what is the refund policy?",
        },
        resourceAttributes: { "deployment.environment": "production" },
      });

      expect(result).toMatchObject({
        spanType: "rag",
        errorType: "TimeoutError",
        ragContextCount: 2,
        deploymentEnvironment: "production",
      });
      expect(result.inputHash).toMatch(/^[1-9]\d*$/);
    });
  });

  describe("given a span whose failure is named only by error.type", () => {
    /** @scenario "The span projection reads error.type when exception.type is absent" */
    it("names the error by error.type", () => {
      expect(facts({ spanAttributes: { "error.type": "500" } }).errorType).toBe("500");
      expect(
        facts({ spanAttributes: { "exception.type": "", "error.type": "500" } }).errorType,
      ).toBe("500");
    });

    it("prefers exception.type when the span sent both", () => {
      expect(
        facts({ spanAttributes: { "exception.type": "ValueError", "error.type": "500" } })
          .errorType,
      ).toBe("ValueError");
    });
  });

  describe("given spans with equal and different inputs", () => {
    it("gives equal inputs one hash and different inputs another", () => {
      const a = facts({ spanAttributes: { "langwatch.input": "same" } }).inputHash;
      const b = facts({ spanAttributes: { "langwatch.input": "same" } }).inputHash;
      const c = facts({ spanAttributes: { "langwatch.input": "other" } }).inputHash;

      expect(a).toBe(b);
      expect(c).not.toBe(a);
    });

    it("hashes no input to 0, whether absent or empty", () => {
      expect(facts({}).inputHash).toBe("0");
      expect(facts({ spanAttributes: { "langwatch.input": "" } }).inputHash).toBe("0");
    });
  });

  describe("given attributes the maps would store as text", () => {
    it("reads a native list of contexts and a resource environment's fallback key", () => {
      const result = facts({
        spanAttributes: { "langwatch.rag.contexts": [{ id: 1 }, { id: 2 }, { id: 3 }] },
        resourceAttributes: { "deployment.environment.name": "staging" },
      });

      expect(result.ragContextCount).toBe(3);
      expect(result.deploymentEnvironment).toBe("staging");
    });

    it("counts 0 contexts when the attribute is absent or not JSON", () => {
      expect(facts({}).ragContextCount).toBe(0);
      expect(
        facts({ spanAttributes: { "langwatch.rag.contexts": "not json" } }).ragContextCount,
      ).toBe(0);
    });
  });
});

describe("spanAnalyticsFloorOf", () => {
  const SINCE = "2026-09-10T00:00:00Z";
  const STARTED = "2026-11-11T10:00:00Z";

  /** @scenario "The span widgets' floor is the replay step's recorded since" */
  it("is the recorded since once the replay is done", () => {
    expect(
      spanAnalyticsFloorOf([
        { status: "done", report: { replayedSince: SINCE }, startedAt: STARTED },
      ]),
    ).toEqual({ from: SINCE, rebuilding: false });
  });

  it("is when the replay began while it still runs", () => {
    expect(
      spanAnalyticsFloorOf([
        { status: "running", report: { replayedSince: SINCE }, startedAt: STARTED },
      ]),
    ).toEqual({ from: STARTED, rebuilding: false });
  });

  /** @scenario "A span widget says its history is still being rebuilt before the replay starts" */
  it("is rebuilding when the ledger records no replay yet", () => {
    expect(spanAnalyticsFloorOf([])).toEqual({ from: null, rebuilding: true });
  });

  it("is rebuilding while the replay is recorded but not started", () => {
    expect(spanAnalyticsFloorOf([{ status: "pending", report: null, startedAt: null }])).toEqual({
      from: null,
      rebuilding: true,
    });
  });

  it("is whole on a fresh install, where the replay is not needed", () => {
    expect(spanAnalyticsFloorOf([{ status: "not-needed", report: null, startedAt: null }])).toEqual(
      { from: null, rebuilding: false },
    );
  });
});

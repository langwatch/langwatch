import { describe, expect, it } from "vitest";
import {
  buildAlertHref,
  buildGraphHref,
  buildTraceDrawerHref,
  buildTracesQueryHref,
  hasLegacyFilters,
  intentToTimeParams,
  intentToTraceQuery,
  isEmptyIntent,
  parseTraceQueryIntent,
  type TraceQueryIntent,
} from "../logic/traceQueryIntent";

const intent = (over: Partial<TraceQueryIntent> = {}): TraceQueryIntent => ({
  filters: {},
  ...over,
});

describe("parseTraceQueryIntent", () => {
  describe("given a search_traces tool input", () => {
    it("lifts the filters, the free text and the date range", () => {
      expect(
        parseTraceQueryIntent({
          query: "refund policy",
          filters: { "traces.error": ["true"] },
          startDate: "7d",
        }),
      ).toEqual({
        filters: { "traces.error": ["true"] },
        text: "refund policy",
        startDate: "7d",
      });
    });
  });

  describe("given filter values that are empty or the wrong shape", () => {
    it("drops them rather than carrying junk into the destination", () => {
      const parsed = parseTraceQueryIntent({
        filters: {
          "spans.model": ["gpt-5-mini"],
          "traces.name": [],
          "metadata.labels": null,
          "traces.origin": 42,
        },
      });
      expect(parsed?.filters).toEqual({ "spans.model": ["gpt-5-mini"] });
    });
  });

  describe("given a non-object input", () => {
    it("returns null so the caller can skip suggesting", () => {
      expect(parseTraceQueryIntent(null)).toBeNull();
      expect(parseTraceQueryIntent("search")).toBeNull();
    });
  });
});

describe("isEmptyIntent", () => {
  describe("given neither a filter nor a search term", () => {
    it("reports the intent as empty — there is nothing to carry", () => {
      expect(isEmptyIntent(intent({ startDate: "24h" }))).toBe(true);
    });
  });

  describe("given a filter or a term", () => {
    it("reports the intent as carryable", () => {
      expect(isEmptyIntent(intent({ text: "refund" }))).toBe(false);
      expect(
        isEmptyIntent(intent({ filters: { "traces.error": ["true"] } })),
      ).toBe(false);
    });
  });
});

describe("intentToTraceQuery", () => {
  describe("when the search filtered on errors", () => {
    it("compiles to the traces-view error status", () => {
      expect(
        intentToTraceQuery(intent({ filters: { "traces.error": ["true"] } })),
      ).toBe("status:error");
    });

    it("negates the clause when the search excluded errors", () => {
      expect(
        intentToTraceQuery(intent({ filters: { "traces.error": ["false"] } })),
      ).toBe("NOT status:error");
    });

    it("drops the clause when both values are present — it constrains nothing", () => {
      expect(
        intentToTraceQuery(
          intent({ filters: { "traces.error": ["true", "false"] } }),
        ),
      ).toBe("");
    });
  });

  describe("when a filter carries several values", () => {
    it("compiles them to an OR group so the search stays equivalent", () => {
      expect(
        intentToTraceQuery(
          intent({ filters: { "spans.model": ["gpt-5-mini", "gpt-5"] } }),
        ),
      ).toBe("(model:gpt-5-mini OR model:gpt-5)");
    });
  });

  describe("when the search combined filters and free text", () => {
    it("ANDs every clause, with the text as a bare term", () => {
      expect(
        intentToTraceQuery(
          intent({
            filters: {
              "traces.error": ["true"],
              "metadata.user_id": ["u_123"],
            },
            text: "refund",
          }),
        ),
      ).toBe("status:error AND user:u_123 AND refund");
    });
  });

  describe("when a value is not a bare word", () => {
    it("quotes it so the query still parses", () => {
      expect(intentToTraceQuery(intent({ text: "refund policy" }))).toBe(
        '"refund policy"',
      );
    });

    it("leaves emails and dotted ids unquoted — the grammar accepts them bare", () => {
      expect(
        intentToTraceQuery(
          intent({ filters: { "metadata.user_id": ["alice@example.com"] } }),
        ),
      ).toBe("user:alice@example.com");
    });
  });

  describe("when the search used a metadata key/value pair", () => {
    it("compiles the pair into the trace-attribute namespace", () => {
      expect(
        intentToTraceQuery(
          intent({
            filters: {
              "metadata.key": ["tenant"],
              "metadata.value": ["acme"],
            },
          }),
        ),
      ).toBe("trace.attribute.tenant:acme");
    });

    it("drops a half-specified pair rather than inventing a filter", () => {
      expect(
        intentToTraceQuery(intent({ filters: { "metadata.key": ["tenant"] } })),
      ).toBe("");
    });
  });

  describe("when the search used a filter the traces view cannot express", () => {
    it("drops it and keeps only what survives the trip", () => {
      expect(
        intentToTraceQuery(
          intent({
            filters: {
              "spans.model": ["gpt-5-mini"],
              "events.metrics.value": ["3"],
            },
          }),
        ),
      ).toBe("model:gpt-5-mini");
    });

    it("compiles to nothing when NOTHING survives, so no suggestion is offered", () => {
      expect(
        intentToTraceQuery(
          intent({ filters: { "events.metrics.value": ["3"] } }),
        ),
      ).toBe("");
    });
  });
});

describe("intentToTimeParams", () => {
  describe("given a relative window", () => {
    it("carries it across as a preset so the link never goes stale", () => {
      expect(intentToTimeParams(intent({ startDate: "7d" }))).toEqual({
        preset: "7d",
      });
    });
  });

  describe("given no window at all", () => {
    it("defaults to the day the search itself defaulted to", () => {
      expect(intentToTimeParams(intent())).toEqual({ preset: "24h" });
    });
  });

  describe("given absolute dates", () => {
    it("carries them across as epoch milliseconds", () => {
      expect(
        intentToTimeParams(
          intent({
            startDate: "2026-07-01T00:00:00.000Z",
            endDate: "2026-07-02T00:00:00.000Z",
          }),
        ),
      ).toEqual({
        from: String(Date.parse("2026-07-01T00:00:00.000Z")),
        to: String(Date.parse("2026-07-02T00:00:00.000Z")),
      });
    });
  });

  describe("given an unparseable date", () => {
    it("falls back to the default window rather than emitting NaN", () => {
      expect(intentToTimeParams(intent({ startDate: "last tuesday" }))).toEqual(
        {
          preset: "24h",
        },
      );
    });
  });
});

describe("buildTracesQueryHref", () => {
  describe("given a carryable search", () => {
    it("pins the query in the fragment against the stable all-traces lens", () => {
      expect(
        buildTracesQueryHref({
          projectSlug: "acme",
          intent: intent({
            filters: { "traces.error": ["true"] },
            startDate: "24h",
          }),
        }),
      ).toBe("/acme/traces#all-traces?q=status%3Aerror&preset=24h");
    });
  });

  describe("given a search that survives nothing", () => {
    it("returns null so no dead link is rendered", () => {
      expect(
        buildTracesQueryHref({ projectSlug: "acme", intent: intent() }),
      ).toBeNull();
    });
  });

  describe("given no project", () => {
    it("returns null", () => {
      expect(
        buildTracesQueryHref({
          projectSlug: null,
          intent: intent({ text: "refund" }),
        }),
      ).toBeNull();
    });
  });
});

describe("buildTraceDrawerHref", () => {
  it("opens one trace in the traces-v2 detail drawer", () => {
    expect(
      buildTraceDrawerHref({ projectSlug: "acme", traceId: "trace_abc" }),
    ).toBe("/acme/traces?drawer.open=traceV2Details&drawer.traceId=trace_abc");
  });

  it("returns null without a trace to open", () => {
    expect(
      buildTraceDrawerHref({ projectSlug: "acme", traceId: null }),
    ).toBeNull();
  });
});

describe("buildGraphHref", () => {
  describe("given a search with filters", () => {
    it("seeds the graph builder with those same filters, no translation needed", () => {
      const href = buildGraphHref({
        projectSlug: "acme",
        intent: intent({
          filters: {
            "traces.error": ["true"],
            "spans.model": ["gpt-5-mini", "gpt-5"],
          },
        }),
      });
      expect(href).toContain("/acme/analytics/custom?");
      expect(href).toContain("has_error=true");
      // qs comma array format — the builder reads both values back.
      expect(href).toContain("model=gpt-5-mini%2Cgpt-5");
    });
  });

  describe("given a text-only search", () => {
    it("returns null — a graph filters on fields, not on free text", () => {
      expect(
        buildGraphHref({
          projectSlug: "acme",
          intent: intent({ text: "refund" }),
        }),
      ).toBeNull();
    });
  });
});

describe("buildAlertHref", () => {
  describe("given a search with filters", () => {
    it("opens the automation drawer with those filters applied", () => {
      const href = buildAlertHref({
        projectSlug: "acme",
        intent: intent({ filters: { "traces.error": ["true"] } }),
      });
      expect(href).toContain("has_error=true");
      expect(href).toContain("drawer.open=automation");
    });
  });

  describe("given nothing an alert could match on", () => {
    it("returns null", () => {
      expect(
        buildAlertHref({ projectSlug: "acme", intent: intent({ text: "hi" }) }),
      ).toBeNull();
    });
  });
});

describe("hasLegacyFilters", () => {
  it("is true when a filter survives into the legacy URL-key form", () => {
    expect(
      hasLegacyFilters(intent({ filters: { "traces.error": ["true"] } })),
    ).toBe(true);
  });

  it("is false for a text-only search", () => {
    expect(hasLegacyFilters(intent({ text: "refund" }))).toBe(false);
  });
});

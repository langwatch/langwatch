import { describe, it, expect } from "vitest";
import { transformElasticSearchTraceToTrace } from "./transformers";
import type { ElasticSearchTrace } from "../tracer/types";
import type { Protections } from "./protections";

describe("transformElasticSearchTraceToTrace", () => {
  it("redacts input values in output when canSeeCapturedInput is false", () => {
    const now = Date.now();
    const trace: ElasticSearchTrace = {
      trace_id: "trace1",
      project_id: "proj1",
      metadata: {},
      timestamps: { started_at: now, inserted_at: now, updated_at: now },
      input: {
        value: JSON.stringify({ somekey: "secret" }),
      },
      output: {
        value: JSON.stringify({ somekey: "secret", another: "visible" }),
      },
      metrics: { total_cost: 1 },
      spans: [
        {
          span_id: "span1",
          trace_id: "trace1",
          project_id: "proj1",
          type: "span",
          name: "span1",
          input: {
            type: "json",
            value: JSON.stringify({ somekey: "secret" }),
          },
          output: {
            type: "json",
            value: JSON.stringify({ somekey: "secret", spanonly: "spanvalue" }),
          },
          timestamps: {
            started_at: now,
            finished_at: now,
            inserted_at: now,
            updated_at: now,
          },
          metrics: { cost: 1 },
        },
        {
          span_id: "span2",
          trace_id: "trace1",
          project_id: "proj1",
          type: "span",
          name: "span2",
          input: {
            type: "json",
            value: JSON.stringify({ somekey: "secret" }),
          },
          output: {
            type: "json",
            value: JSON.stringify({ another: "visible" }),
          },
          timestamps: {
            started_at: now,
            finished_at: now,
            inserted_at: now,
            updated_at: now,
          },
          metrics: { cost: 2 },
        },
      ],
    };

    const protections: Protections = {
      canSeeCapturedInput: false,
      canSeeCapturedOutput: true,
      canSeeCosts: true,
    };

    const result = transformElasticSearchTraceToTrace(trace, protections);

    // Top-level input should be undefined
    expect(result.input).toBeUndefined();
    // Output should redact keys that were present in input
    expect(result.output).toEqual({
      value: JSON.stringify({ somekey: "[REDACTED]", another: "visible" }),
    });

    // Spans: input should be [REDACTED], output should redact keys present in input
    expect(result.spans).toBeDefined();
    if (result.spans) {
      expect(result.spans[0]?.input).toEqual({
        type: "text",
        value: "[REDACTED]",
      });
      expect(result.spans[0]?.output).toEqual({
        type: "json",
        value: { somekey: "[REDACTED]", spanonly: "spanvalue" },
      });
      expect(result.spans[1]?.input).toEqual({
        type: "text",
        value: "[REDACTED]",
      });
      expect(result.spans[1]?.output).toEqual({
        type: "json",
        value: { another: "visible" },
      });
    }
  });

  it("redacts values inside python-parsable structures", () => {
    const now = Date.now();

    const trace: ElasticSearchTrace = {
      trace_id: "trace2",
      project_id: "proj1",
      metadata: {},
      timestamps: { started_at: now, inserted_at: now, updated_at: now },
      input: {
        value: 'MyPythonClass(some_attribute="secret")',
      },
      output: {
        value: 'MyPythonClass(some_attribute="secret", another="visible")',
      },
      metrics: { total_cost: 1 },
      spans: [
        {
          span_id: "span1",
          trace_id: "trace2",
          project_id: "proj1",
          type: "span",
          name: "span1",
          input: {
            type: "text",
            value: 'MyPythonClass(some_attribute="secret")',
          },
          output: {
            type: "text",
            value: 'MyPythonClass(some_attribute="secret", another="visible")',
          },
          timestamps: {
            started_at: now,
            finished_at: now,
            inserted_at: now,
            updated_at: now,
          },
          metrics: { cost: 1 },
        },
      ],
    };

    const protections: Protections = {
      canSeeCapturedInput: false,
      canSeeCapturedOutput: true,
      canSeeCosts: true,
    };

    const result = transformElasticSearchTraceToTrace(trace, protections);

    expect(result.input).toBeUndefined();
    // Output should redact 'secret' in the python-like structure (as parsed JSON)
    expect(result.output).toEqual({
      value: JSON.stringify({
        MyPythonClass: {
          some_attribute: "[REDACTED]",
          another: "visible",
        },
      }),
    });

    expect(result.spans).toBeDefined();
    if (result.spans) {
      expect(result.spans[0]?.input).toEqual({
        type: "text",
        value: "[REDACTED]",
      });
      expect(result.spans[0]?.output).toEqual({
        type: "raw",
        value: JSON.stringify({
          MyPythonClass: {
            some_attribute: "[REDACTED]",
            another: "visible",
          },
        }),
      });
    }
  });

  it("does not redact when both input and output are visible", () => {
    const now = Date.now();
    const trace: ElasticSearchTrace = {
      trace_id: "trace3",
      project_id: "proj1",
      metadata: {},
      timestamps: { started_at: now, inserted_at: now, updated_at: now },
      input: {
        value: JSON.stringify({ somekey: "secret", another: "visible" }),
      },
      output: {
        value: JSON.stringify({ somekey: "secret", another: "visible" }),
      },
      metrics: { total_cost: 1 },
      spans: [
        {
          span_id: "span1",
          trace_id: "trace3",
          project_id: "proj1",
          type: "span",
          name: "span1",
          input: {
            type: "json",
            value: JSON.stringify({ somekey: "secret", spanonly: "spanvalue" }),
          },
          output: {
            type: "json",
            value: JSON.stringify({ somekey: "secret", spanonly: "spanvalue" }),
          },
          timestamps: {
            started_at: now,
            finished_at: now,
            inserted_at: now,
            updated_at: now,
          },
          metrics: { cost: 1 },
        },
        {
          span_id: "span2",
          trace_id: "trace3",
          project_id: "proj1",
          type: "span",
          name: "span2",
          input: {
            type: "json",
            value: JSON.stringify({ another: "visible" }),
          },
          output: {
            type: "json",
            value: JSON.stringify({ another: "visible" }),
          },
          timestamps: {
            started_at: now,
            finished_at: now,
            inserted_at: now,
            updated_at: now,
          },
          metrics: { cost: 2 },
        },
      ],
    };

    const protections: Protections = {
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
      canSeeCosts: true,
    };

    const result = transformElasticSearchTraceToTrace(trace, protections);

    // Top-level input and output should be present and unredacted
    expect(result.input).toEqual({
      value: JSON.stringify({ somekey: "secret", another: "visible" }),
    });
    expect(result.output).toEqual({
      value: JSON.stringify({ somekey: "secret", another: "visible" }),
    });

    // Spans: input and output should be present and unredacted
    expect(result.spans).toBeDefined();
    if (result.spans) {
      expect(result.spans[0]?.input).toEqual({
        type: "json",
        value: { somekey: "secret", spanonly: "spanvalue" },
      });
      expect(result.spans[0]?.output).toEqual({
        type: "json",
        value: { somekey: "secret", spanonly: "spanvalue" },
      });
      expect(result.spans[1]?.input).toEqual({
        type: "json",
        value: { another: "visible" },
      });
      expect(result.spans[1]?.output).toEqual({
        type: "json",
        value: { another: "visible" },
      });
    }
  });
});

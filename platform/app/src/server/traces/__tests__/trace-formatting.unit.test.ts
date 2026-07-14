import { describe, expect, it } from "vitest";
import { formatTraceSummaryDigest } from "../trace-formatting";
import type { Trace } from "~/server/tracer/types";

describe("formatTraceSummaryDigest()", () => {
  const baseTrace: Pick<Trace, "trace_id" | "project_id" | "metadata" | "timestamps" | "spans"> = {
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
    spans: [],
  };

  describe("when trace has input and output", () => {
    it("returns truncated input and output", () => {
      const trace = {
        ...baseTrace,
        input: { value: "What is the weather?" },
        output: { value: "The weather is sunny today." },
      } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Input: What is the weather?");
      expect(result).toContain("Output: The weather is sunny today.");
    });
  });

  describe("when input exceeds 200 characters", () => {
    it("truncates with ellipsis", () => {
      const longInput = "A".repeat(300);
      const trace = {
        ...baseTrace,
        input: { value: longInput },
        output: { value: "short" },
      } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Input: " + "A".repeat(200) + "...");
      expect(result).not.toContain("A".repeat(201));
    });
  });

  describe("when output exceeds 200 characters", () => {
    it("truncates with ellipsis", () => {
      const longOutput = "B".repeat(300);
      const trace = {
        ...baseTrace,
        input: { value: "hello" },
        output: { value: longOutput },
      } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Output: " + "B".repeat(200) + "...");
      expect(result).not.toContain("B".repeat(201));
    });
  });

  describe("when trace has no input", () => {
    it("shows N/A for input", () => {
      const trace = {
        ...baseTrace,
        output: { value: "response" },
      } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Input: N/A");
      expect(result).toContain("Output: response");
    });
  });

  describe("when trace has no output", () => {
    it("shows N/A for output", () => {
      const trace = {
        ...baseTrace,
        input: { value: "question" },
      } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Input: question");
      expect(result).toContain("Output: N/A");
    });
  });

  describe("when trace has neither input nor output", () => {
    it("shows N/A for both", () => {
      const trace = { ...baseTrace } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Input: N/A");
      expect(result).toContain("Output: N/A");
    });
  });

  describe("when input is exactly 200 characters", () => {
    it("does not add ellipsis", () => {
      const exactInput = "C".repeat(200);
      const trace = {
        ...baseTrace,
        input: { value: exactInput },
        output: { value: "ok" },
      } as Trace;

      const result = formatTraceSummaryDigest(trace);

      expect(result).toContain("Input: " + "C".repeat(200));
      expect(result).not.toContain("...");
    });
  });
});

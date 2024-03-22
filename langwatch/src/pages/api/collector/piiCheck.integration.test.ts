import { describe, expect, it } from "vitest";
import type { Trace } from "../../../server/tracer/types";
import { runPiiCheck } from "./piiCheck";

describe("PIICheck", () => {
  it("detects PII on traces", async () => {
    const sampleTrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      metadata: {},
      input: { value: "hi there" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };
    const response = await runPiiCheck(sampleTrace, []);
    expect(response).toEqual({
      quotes: [],
    });

    const samplePIITrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      metadata: {},
      input: {
        value: "hi there, my credit card number is 4012-8888-8888-1881",
      },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const quotes = (await runPiiCheck(samplePIITrace, [])).quotes;
    expect(quotes).toEqual(["4012-8888-8888-1881"]);
  });
});

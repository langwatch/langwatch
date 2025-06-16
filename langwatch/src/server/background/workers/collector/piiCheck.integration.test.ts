import { describe, expect, it } from "vitest";
import type { Trace } from "../../../tracer/types";
import { cleanupPIIs } from "./piiCheck";
import { PIIRedactionLevel } from "@prisma/client";

describe("PIICheck", () => {
  it("detects PII on traces", async () => {
    const sampleTrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      metadata: {},
      input: { value: "hi there" },
      metrics: {},
      timestamps: {
        started_at: Date.now(),
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
      spans: [],
    };
    await cleanupPIIs(sampleTrace, [], {
      piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
      enforced: true,
      mainMethod: "presidio",
    });
    expect(sampleTrace.input?.value).toEqual("hi there");

    const samplePIITrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      metadata: {},
      input: {
        value: "hi there, my credit card number is 4012-8888-8888-1881",
      },
      metrics: {},
      timestamps: {
        started_at: Date.now(),
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
      spans: [],
    };

    await cleanupPIIs(samplePIITrace, [], {
      piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
      enforced: true,
      mainMethod: "presidio",
    });
    expect(samplePIITrace.input?.value).toEqual(
      "hi there, my credit card number is <CREDIT_CARD>"
    );
  });

  it("detects PII on traces using google dlp", async () => {
    const sampleTrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      metadata: {},
      input: { value: "hi there" },
      metrics: {},
      timestamps: {
        started_at: Date.now(),
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
      spans: [],
    };
    await cleanupPIIs(sampleTrace, [], {
      piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
      enforced: true,
      mainMethod: "google_dlp",
    });
    expect(sampleTrace.input?.value).toEqual("hi there");

    const samplePIITrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      metadata: {},
      input: {
        value: "hi there, my credit card number is 4012-8888-8888-1881",
      },
      metrics: {},
      timestamps: {
        started_at: Date.now(),
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
      spans: [],
    };

    await cleanupPIIs(samplePIITrace, [], {
      piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
      enforced: true,
      mainMethod: "google_dlp",
    });
    expect(samplePIITrace.input?.value).toEqual(
      "hi there, my credit card number is [REDACTED]"
    );
  });
});

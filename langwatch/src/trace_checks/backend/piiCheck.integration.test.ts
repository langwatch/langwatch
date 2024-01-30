import { describe, expect, it } from "vitest";
import type { Trace } from "../../server/tracer/types";
import { piiCheck } from "./piiCheck";
import type { google } from "@google-cloud/dlp/build/protos/protos";

describe("PIICheck", () => {
  it("detects PII on traces", async () => {
    const sampleTrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      input: { value: "hi there" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
    };
    let response = await piiCheck(sampleTrace, [], {
      infoTypes: { creditCardNumber: true } as any,
      minLikelihood: "POSSIBLE",
      checkPiiInSpans: true,
    });
    expect(response).toEqual({
      costs: [],
      raw_result: { findings: [] },
      status: "succeeded",
      value: 0,
    });

    const samplePIITrace: Trace = {
      trace_id: "foo",
      project_id: "foo",
      input: {
        value: "hi there, my credit card number is 4012-8888-8888-1881",
      },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
    };
    response = await piiCheck(samplePIITrace, [], {
      infoTypes: { creditCardNumber: true } as any,
      minLikelihood: "POSSIBLE",
      checkPiiInSpans: true,
    });
    const findings = (response.raw_result as any)
      .findings as google.privacy.dlp.v2.IFinding[];
    expect(response.value).toEqual(1);
    expect(response.status).toEqual("failed");
    expect(findings[0]?.infoType?.name).toBe("CREDIT_CARD_NUMBER");
  });
});

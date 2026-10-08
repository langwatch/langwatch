/**
 * @vitest-environment node
 * Which credential refusals the OTLP doors render in their own wire.
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { isIngestDoorRefusal, otlpDoorFailureAnswer } from "../door.ts";

/** The project module's refusal, stood in for here: this package imports no module. */
class AggregateRefusal extends HandledError {
  constructor() {
    super("aggregate_project_has_no_credential", "This project accepts no API key.", {
      httpStatus: 403,
      fault: "customer",
      meta: { projectId: "project_aggregate" },
    });
  }
}

describe("an ingestion door's own refusals", () => {
  describe("given a key presented for an aggregate project (ADR-175 decision 7)", () => {
    const refusal = new AggregateRefusal();

    it("is one the door renders itself, as main's ceiling denial did", () => {
      expect(isIngestDoorRefusal(refusal)).toBe(true);
    });

    it("answers 403 naming the code and the project", () => {
      const answer = otlpDoorFailureAnswer({
        result: { outcome: "refused", refusal },
        signal: "traces",
      });

      expect(answer).toMatchObject({
        status: 403,
        body: { error: "aggregate_project_has_no_credential", projectId: "project_aggregate" },
      });
    });
  });
});

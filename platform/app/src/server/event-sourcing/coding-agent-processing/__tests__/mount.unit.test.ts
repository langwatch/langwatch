import { validateMount } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  assertCodingAgentProcessingMountsAreLegal,
  codingAgentSessionContributionsMount,
  codingAgentSessionMount,
  codingAgentTraceSessionsMount,
} from "../mount";

describe("given this pipeline's three mounts", () => {
  describe("when checked against ADR-106's legality table", () => {
    it("the identity fold mount has no violations", () => {
      expect(validateMount(codingAgentSessionMount)).toEqual([]);
    });

    it("the trace-sessions map mount has no violations", () => {
      expect(validateMount(codingAgentTraceSessionsMount)).toEqual([]);
    });

    it("the session-contributions map mount has no violations", () => {
      expect(validateMount(codingAgentSessionContributionsMount)).toEqual([]);
    });

    it("assertCodingAgentProcessingMountsAreLegal does not throw", () => {
      expect(() => assertCodingAgentProcessingMountsAreLegal()).not.toThrow();
    });
  });

  describe("when the fold mount is scoped to one aggregate", () => {
    it("is required — a fold on any wider scope would race the read-modify-write cycle", () => {
      expect(codingAgentSessionMount.scope).toBe("aggregate");
      expect(codingAgentSessionMount.store).toBe("replace");
    });
  });
});

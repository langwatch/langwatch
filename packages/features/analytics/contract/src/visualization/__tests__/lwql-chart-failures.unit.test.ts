/**
 * The two refusals no specification can be checked for in advance.
 *
 * Named here because `ruleCoverage.unit.test.ts` reads this file to prove the
 * rules `render.failure` and `encoding.empty` are covered — a claim that only
 * counts if this file really exercises them.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { lwqlEmptyEncodingFailure, lwqlRenderFailure } from "../lwql-chart-failures";
import { LangWatchQLVegaLoadBlockedError } from "../no-network-vega-loader";

describe("the refusals the chart layer raises", () => {
  describe("given a failure from inside the chart runtime", () => {
    /** @scenario "Chart failures are explicit and do not discard the table" */
    it("carries the reason under the render.failure rule", () => {
      const failure = lwqlRenderFailure(new Error("Unrecognized signal name"));

      expect(failure.rule).toBe("render.failure");
      expect(failure.code).toBe("render-failure");
      expect(failure.message).toContain("Unrecognized signal name");
      expect(failure.path).toBe("/");
    });

    it("still names a cause when whatever was thrown had no message", () => {
      const failure = lwqlRenderFailure("something odd");

      expect(failure.rule).toBe("render.failure");
      expect(failure.message.length).toBeGreaterThan(0);
    });

    /** @scenario "No renderer path performs network or file loading" */
    it("keeps a blocked load's own detail rather than flattening it", () => {
      const blocked = new LangWatchQLVegaLoadBlockedError({
        reference: "https://example.test/secret?token=abc",
        method: "http",
      });

      const failure = lwqlRenderFailure(blocked);

      expect(failure.rule).toBe("loader.blocked");
      expect(failure.code).toBe("loader-blocked");
      expect(failure.message).not.toContain("token=abc");
    });
  });

  describe("given every encoded value is empty", () => {
    /** @scenario "Chart failures are explicit and do not discard the table" */
    it("names the columns under the encoding.empty rule", () => {
      const failure = lwqlEmptyEncodingFailure({
        fieldsByDataset: { query_result: ["model", "total"] },
      });

      expect(failure.rule).toBe("encoding.empty");
      expect(failure.code).toBe("empty-encoding");
      expect(failure.message).toContain("model");
      expect(failure.message).toContain("total");
    });

    it("still says what happened when it cannot name a column", () => {
      const failure = lwqlEmptyEncodingFailure({
        fieldsByDataset: { query_result: [] },
      });

      expect(failure.rule).toBe("encoding.empty");
      expect(failure.message).toContain("nothing to draw");
    });
  });
});

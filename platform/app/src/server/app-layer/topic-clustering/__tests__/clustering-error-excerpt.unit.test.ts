/**
 * @vitest-environment node
 *
 * A clustering failure message is written to the EVENT LOG by
 * `recordClusteringRunFailed`, so whatever it quotes becomes durable state.
 * The excerpt used to be cut at the first 10 lines of pretty-printed JSON — a
 * line bound, which one long line walks straight through — and a pydantic 422
 * from langevals replies by echoing the value it rejected, which for us is a
 * trace's own text.
 *
 * @see specs/topic-clustering
 */

import { describe, expect, it } from "vitest";
import {
  boundClusteringErrorMessage,
  CLUSTERING_ERROR_EXCERPT_MAX_BYTES,
  clusteringErrorExcerpt,
  truncateToBytes,
} from "../clustering-error-excerpt";

const TRACE_TEXT = "customer asked about refunding order 4471 for Ada Lovelace";

/** The marker `truncateToBytes` appends once it has cut. */
const TRUNCATION_MARKER_BYTES = Buffer.byteLength("… [truncated]", "utf8");

describe("clusteringErrorExcerpt", () => {
  describe("given a validation error that echoes the request back", () => {
    describe("when the excerpt is built", () => {
      it("drops the echoed input value while keeping the diagnosis", () => {
        const body = JSON.stringify({
          detail: [
            {
              type: "string_too_long",
              loc: ["body", "traces", 0, "input"],
              msg: "String should have at most 8192 characters",
              input: TRACE_TEXT,
            },
          ],
        });

        const excerpt = clusteringErrorExcerpt(body);

        expect(excerpt).not.toContain(TRACE_TEXT);
        expect(excerpt).toContain("string_too_long");
        expect(excerpt).toContain("String should have at most 8192 characters");
      });

      it("drops echoed input nested at any depth", () => {
        const body = JSON.stringify({
          error: { context: { retry: { input: TRACE_TEXT } } },
        });

        expect(clusteringErrorExcerpt(body)).not.toContain(TRACE_TEXT);
      });
    });
  });

  describe("given a body whose content is all on one line", () => {
    describe("when the excerpt is built", () => {
      it("bounds it in bytes rather than in lines", () => {
        const body = JSON.stringify({ detail: "x".repeat(200_000) });

        const excerpt = clusteringErrorExcerpt(body);

        expect(Buffer.byteLength(excerpt, "utf8")).toBeLessThanOrEqual(
          CLUSTERING_ERROR_EXCERPT_MAX_BYTES + TRUNCATION_MARKER_BYTES,
        );
      });
    });
  });

  describe("given a body that is not JSON", () => {
    describe("when the excerpt is built", () => {
      it("still bounds it", () => {
        const excerpt = clusteringErrorExcerpt("y".repeat(200_000));

        expect(Buffer.byteLength(excerpt, "utf8")).toBeLessThanOrEqual(
          CLUSTERING_ERROR_EXCERPT_MAX_BYTES + TRUNCATION_MARKER_BYTES,
        );
      });

      it("leaves a short one untouched", () => {
        expect(clusteringErrorExcerpt("502 Bad Gateway")).toBe(
          "502 Bad Gateway",
        );
      });
    });
  });
});

describe("truncateToBytes", () => {
  describe("given a cut that lands mid-codepoint", () => {
    describe("when the text is truncated", () => {
      it("does not end in a replacement character", () => {
        // "😀" is 4 UTF-8 bytes, so a 3-byte bound splits the first one.
        const truncated = truncateToBytes({ text: "😀😀😀", maxBytes: 3 });

        expect(truncated).not.toContain("�");
      });
    });
  });
});

describe("boundClusteringErrorMessage", () => {
  describe("given a message far larger than the bound", () => {
    describe("when it is bounded before reaching the event log", () => {
      it("caps the bytes that can be recorded", () => {
        const bounded = boundClusteringErrorMessage("z".repeat(500_000));

        expect(Buffer.byteLength(bounded, "utf8")).toBeLessThan(10_000);
      });
    });
  });
});

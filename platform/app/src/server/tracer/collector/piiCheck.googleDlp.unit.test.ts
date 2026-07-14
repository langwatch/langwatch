import { beforeEach, describe, expect, it, vi } from "vitest";

const { inspectContentMock } = vi.hoisted(() => ({
  inspectContentMock: vi.fn(),
}));

vi.mock("@google-cloud/dlp", () => ({
  DlpServiceClient: class {
    inspectContent = inspectContentMock;
  },
}));

vi.mock("~/env.mjs", () => ({
  env: {
    GOOGLE_APPLICATION_CREDENTIALS: JSON.stringify({
      project_id: "test-project",
    }),
  },
}));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: () => ({ inc: () => undefined }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

import { googleDLPClearPII } from "./piiCheck";

function mockFindings(
  ranges: { start: number; end: number }[],
): void {
  inspectContentMock.mockResolvedValue([
    {
      result: {
        findings: ranges.map(({ start, end }) => ({
          location: { codepointRange: { start, end } },
        })),
      },
    },
  ]);
}

describe("googleDLPClearPII", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given DLP returns two findings on a value longer than the 250k scan window", () => {
    // "John met Mary" padded to exactly 250_000 chars, then a tail beyond the
    // scan window. The tail is never sent to DLP and must survive redaction.
    const scanned = "John met Mary".padEnd(250_000, ".");
    const value = scanned + "TAIL";

    describe("when both findings are applied", () => {
      it("persists both redactions (not just the last) and preserves the tail", async () => {
        // "John" at codepoints [0,4) — also pins the offset-0 finding, which
        // the old `if (start && end)` guard silently skipped.
        // "Mary" at codepoints [9,13).
        mockFindings([
          { start: 0, end: 4 },
          { start: 9, end: 13 },
        ]);
        const wrapper = { value };

        await googleDLPClearPII(wrapper, "value", "STRICT");

        expect(wrapper.value.startsWith("[REDACTED] met [REDACTED]")).toBe(
          true,
        );
        expect(wrapper.value).not.toContain("John");
        expect(wrapper.value).not.toContain("Mary");
        expect(wrapper.value.endsWith("TAIL")).toBe(true);
      });
    });
  });

  describe("given text containing non-BMP characters before the finding", () => {
    describe("when DLP reports codepoint offsets", () => {
      it("converts them to code-unit indices so the mask lands on the PII", async () => {
        // "😀😀John" — DLP counts codepoints: 😀(0) 😀(1) J(2) o(3) h(4) n(5),
        // so "John" is codepoints [2,6). In UTF-16 code units it is [4,8).
        mockFindings([{ start: 2, end: 6 }]);
        const wrapper = { value: "😀😀John" };

        await googleDLPClearPII(wrapper, "value", "STRICT");

        expect(wrapper.value).toBe("😀😀[REDACTED]");
      });
    });
  });

  describe("given DLP returns no findings", () => {
    describe("when the check completes", () => {
      it("leaves the value untouched", async () => {
        mockFindings([]);
        const wrapper = { value: "nothing sensitive here" };

        await googleDLPClearPII(wrapper, "value", "STRICT");

        expect(wrapper.value).toBe("nothing sensitive here");
      });
    });
  });
});

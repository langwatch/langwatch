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

function mockFindings(ranges: { start: number; end: number }[]): void {
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

        await googleDLPClearPII({
          currentObject: wrapper,
          lastKey: "value",
          piiRedactionLevel: "STRICT",
        });

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

        await googleDLPClearPII({
          currentObject: wrapper,
          lastKey: "value",
          piiRedactionLevel: "STRICT",
        });

        expect(wrapper.value).toBe("😀😀[REDACTED]");
      });
    });
  });

  describe("given DLP returns no findings", () => {
    describe("when the check completes", () => {
      it("leaves the value untouched", async () => {
        mockFindings([]);
        const wrapper = { value: "nothing sensitive here" };

        await googleDLPClearPII({
          currentObject: wrapper,
          lastKey: "value",
          piiRedactionLevel: "STRICT",
        });

        expect(wrapper.value).toBe("nothing sensitive here");
      });
    });
  });
});

describe("googleDLPClearPII with exception patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a finding whose matched text matches an exception", async () => {
    // "res 00528000043000 x": the 14-digit number spans codepoints [4, 18).
    const wrapper = { value: "res 00528000043000 x" };
    mockFindings([{ start: 4, end: 18 }]);
    await googleDLPClearPII({
      currentObject: wrapper,
      lastKey: "value",
      piiRedactionLevel: "STRICT",
      exceptPatterns: ["00\\d{12}"],
    });
    expect(wrapper.value).toBe("res 00528000043000 x");
  });

  /** @scenario An exception pattern keeps a business identifier while other PII is still redacted */
  it("preserves the whole excepted span when an overlapping finding is masked", async () => {
    // Finding A [4, 18) is the excepted number; finding B [10, 20) overlaps
    // its tail plus " x". Only the part of B outside the protected range may
    // be masked: the number itself must survive character for character.
    const wrapper = { value: "res 00528000043000 x" };
    mockFindings([
      { start: 4, end: 18 },
      { start: 10, end: 20 },
    ]);
    await googleDLPClearPII({
      currentObject: wrapper,
      lastKey: "value",
      piiRedactionLevel: "STRICT",
      exceptPatterns: ["00\\d{12}"],
    });
    expect(wrapper.value).toBe("res 00528000043000[REDACTED]");
  });

  it("masks normally when no exception matches", async () => {
    const wrapper = { value: "res 00528000043000 x" };
    mockFindings([{ start: 4, end: 18 }]);
    await googleDLPClearPII({
      currentObject: wrapper,
      lastKey: "value",
      piiRedactionLevel: "STRICT",
      exceptPatterns: ["zz\\d{4}"],
    });
    expect(wrapper.value).toBe("res [REDACTED] x");
  });
});

describe("googleDLPClearPII sparing names and places", () => {
  // "claude-sonnet-4-6+12345678901": "claude" is misread as a first name at
  // [0,6); the phone number sits at [18,29).
  const value = "claude-sonnet-4-6+12345678901";

  beforeEach(() => {
    vi.clearAllMocks();
    inspectContentMock.mockResolvedValue([
      {
        result: {
          findings: [
            {
              infoType: { name: "FIRST_NAME" },
              location: { codepointRange: { start: 0, end: 6 } },
            },
            {
              infoType: { name: "PHONE_NUMBER" },
              location: { codepointRange: { start: 18, end: 29 } },
            },
          ],
        },
      },
    ]);
  });

  it("masks only the phone number when the value is flagged", async () => {
    const wrapper = { value };
    await googleDLPClearPII({
      currentObject: wrapper,
      lastKey: "value",
      piiRedactionLevel: "STRICT",
      spareNamesAndPlaces: true,
    });
    expect(wrapper.value).toBe("claude-sonnet-4-6+[REDACTED]");
  });

  /** @scenario "A spared name an exception keeps still blocks an overlapping finding on the fallback detector" */
  it("still protects a spared name an exception keeps from an overlapping finding", async () => {
    // "claude" is kept by an exception; a phone finding that starts inside it
    // must not mask into it, even though the name finding itself is spared.
    inspectContentMock.mockResolvedValue([
      {
        result: {
          findings: [
            {
              infoType: { name: "FIRST_NAME" },
              location: { codepointRange: { start: 0, end: 6 } },
            },
            {
              infoType: { name: "PHONE_NUMBER" },
              location: { codepointRange: { start: 3, end: 29 } },
            },
          ],
        },
      },
    ]);
    const wrapper = { value };
    await googleDLPClearPII({
      currentObject: wrapper,
      lastKey: "value",
      piiRedactionLevel: "STRICT",
      exceptPatterns: ["claude"],
      spareNamesAndPlaces: true,
    });
    expect(wrapper.value).toBe("claude[REDACTED]");
  });

  it("masks the name too when the value is not flagged", async () => {
    const wrapper = { value };
    await googleDLPClearPII({
      currentObject: wrapper,
      lastKey: "value",
      piiRedactionLevel: "STRICT",
    });
    expect(wrapper.value).toBe("[REDACTED]-sonnet-4-6+[REDACTED]");
  });
});

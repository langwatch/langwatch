import { describe, it, expect } from "vitest";
import { matchGlob, selectTests, buildGrepPattern } from "../test-selection";

describe("matchGlob()", () => {
  describe("when using double-star patterns", () => {
    it("matches a file directly inside the directory", () => {
      expect(matchGlob("skills/tracing/SKILL.md", "skills/tracing/**")).toBe(
        true
      );
    });

    it("matches a file nested deeply inside the directory", () => {
      expect(
        matchGlob(
          "skills/tracing/nested/deep/file.ts",
          "skills/tracing/**"
        )
      ).toBe(true);
    });

    it("does not match a file in a different directory", () => {
      expect(
        matchGlob("skills/evaluations/SKILL.md", "skills/tracing/**")
      ).toBe(false);
    });

    it("matches when double-star is in the middle of the pattern", () => {
      expect(
        matchGlob(
          "skills/_tests/fixtures/python-openai/main.py",
          "skills/_tests/fixtures/python-openai/**"
        )
      ).toBe(true);
    });

    it("matches a file at the exact directory level (zero segments)", () => {
      expect(
        matchGlob("skills/_shared/mcp-setup.md", "skills/_shared/**")
      ).toBe(true);
    });
  });

  describe("when using single-star patterns", () => {
    it("matches a file with any characters in the segment", () => {
      expect(
        matchGlob("skills/_tests/vitest.config.ts", "skills/_tests/*.config.ts")
      ).toBe(true);
    });

    it("does not match a file in a nested directory", () => {
      expect(
        matchGlob(
          "skills/_tests/nested/vitest.config.ts",
          "skills/_tests/*.config.ts"
        )
      ).toBe(false);
    });
  });

  describe("when using exact match patterns", () => {
    it("matches an exact file path", () => {
      expect(
        matchGlob(
          "skills/_tests/vitest.config.ts",
          "skills/_tests/vitest.config.ts"
        )
      ).toBe(true);
    });

    it("does not match a different file", () => {
      expect(
        matchGlob("skills/_tests/package.json", "skills/_tests/vitest.config.ts")
      ).toBe(false);
    });
  });

  describe("when the file path does not match at all", () => {
    it("returns false for completely unrelated paths", () => {
      expect(matchGlob("langwatch/src/index.ts", "skills/tracing/**")).toBe(
        false
      );
    });
  });
});

describe("selectTests()", () => {
  const touchfiles: Record<string, string[]> = {
    "tracing-py-openai": [
      "skills/tracing/**",
      "skills/_shared/**",
      "skills/_tests/fixtures/python-openai/**",
    ],
    "evaluations-py-openai": [
      "skills/evaluations/**",
      "skills/_shared/**",
      "skills/_tests/fixtures/python-openai/**",
    ],
    "prompts-py-openai": [
      "skills/prompts/**",
      "skills/_shared/**",
      "skills/_tests/fixtures/python-openai/**",
    ],
  };

  const globalTouchfiles = [
    "skills/_tests/helpers/**",
    "skills/_tests/vitest.config.ts",
    "skills/_tests/package.json",
    "skills/_compiler/**",
  ];

  describe("when only a specific skill directory changed", () => {
    it("selects only the tests that depend on that directory", () => {
      const changedFiles = ["skills/tracing/SKILL.md"];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toContain("tracing-py-openai");
      expect(selected).not.toContain("evaluations-py-openai");
      expect(selected).not.toContain("prompts-py-openai");
    });
  });

  describe("when a shared dependency changed", () => {
    it("selects tests that depend on the shared directory", () => {
      const changedFiles = ["skills/_shared/mcp-setup.md"];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toContain("tracing-py-openai");
      expect(selected).toContain("evaluations-py-openai");
      expect(selected).toContain("prompts-py-openai");
    });
  });

  describe("when a global touchfile changed", () => {
    it("selects all tests", () => {
      const changedFiles = ["skills/_compiler/compile.ts"];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toEqual(
        expect.arrayContaining([
          "tracing-py-openai",
          "evaluations-py-openai",
          "prompts-py-openai",
        ])
      );
      expect(selected).toHaveLength(3);
    });
  });

  describe("when a helper file changed", () => {
    it("selects all tests via global touchfiles", () => {
      const changedFiles = ["skills/_tests/helpers/shared.ts"];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toHaveLength(3);
    });
  });

  describe("when no relevant files changed", () => {
    it("returns an empty array", () => {
      const changedFiles = ["langwatch/src/pages/index.tsx"];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toHaveLength(0);
    });
  });

  describe("when the changeset is empty", () => {
    it("returns an empty array", () => {
      const selected = selectTests([], touchfiles, globalTouchfiles);
      expect(selected).toHaveLength(0);
    });
  });

  describe("when multiple files changed across different skills", () => {
    it("selects tests from both affected skills", () => {
      const changedFiles = [
        "skills/tracing/SKILL.md",
        "skills/evaluations/SKILL.md",
      ];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toContain("tracing-py-openai");
      expect(selected).toContain("evaluations-py-openai");
      expect(selected).not.toContain("prompts-py-openai");
    });
  });

  describe("when a fixture changed", () => {
    it("selects tests that use that fixture", () => {
      const changedFiles = ["skills/_tests/fixtures/python-openai/main.py"];
      const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
      expect(selected).toContain("tracing-py-openai");
      expect(selected).toContain("evaluations-py-openai");
      expect(selected).toContain("prompts-py-openai");
    });
  });

  it("returns results sorted alphabetically", () => {
    const changedFiles = ["skills/_shared/mcp-setup.md"];
    const selected = selectTests(changedFiles, touchfiles, globalTouchfiles);
    const sorted = [...selected].sort();
    expect(selected).toEqual(sorted);
  });
});

describe("buildGrepPattern()", () => {
  describe("when given selected test names", () => {
    it("produces a regex pattern matching all of them", () => {
      const selected = ["tracing-py-openai", "evaluations-ts-vercel"];
      const pattern = buildGrepPattern(selected);
      expect(pattern).toBeDefined();
      const regex = new RegExp(pattern!);
      expect(regex.test("tracing-py-openai")).toBe(true);
      expect(regex.test("evaluations-ts-vercel")).toBe(true);
      expect(regex.test("prompts-py-openai")).toBe(false);
    });
  });

  describe("when given an empty selection", () => {
    it("returns undefined", () => {
      const pattern = buildGrepPattern([]);
      expect(pattern).toBeUndefined();
    });
  });

  describe("when test names contain special regex characters", () => {
    it("escapes them properly", () => {
      const selected = [
        "instruments code without env API key — discovers from .env file",
      ];
      const pattern = buildGrepPattern(selected);
      expect(pattern).toBeDefined();
      const regex = new RegExp(pattern!);
      expect(
        regex.test(
          "instruments code without env API key — discovers from .env file"
        )
      ).toBe(true);
    });
  });
});

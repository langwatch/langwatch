import { describe, expect, it } from "vitest";

import { belowVersion, parseReachableVersion } from "./pip-index";

/** pip 26 in a venv that does not have the package: no INSTALLED, no LATEST. */
const NOT_INSTALLED = `langwatch (0.1.32)
Available versions: 0.1.32, 0.1.31, 0.1.30, 0.0.1
`;

/** The same command where the package is installed: the two extra lines. */
const INSTALLED = `langwatch (1.4.0)
Available versions: 1.4.0, 1.3.0, 0.1.32
  INSTALLED: 1.3.0
  LATEST:    1.4.0
`;

describe("parseReachableVersion", () => {
  it("reads the header line, which is the only one a fresh venv prints", () => {
    expect(
      parseReachableVersion({ output: NOT_INSTALLED, name: "langwatch" }),
    ).toBe("0.1.32");
  });

  it("prefers LATEST when the package is installed and pip prints it", () => {
    expect(
      parseReachableVersion({ output: INSTALLED, name: "langwatch" }),
    ).toBe("1.4.0");
  });

  it("falls back to the first of the available versions, which are newest first", () => {
    expect(
      parseReachableVersion({
        output: "Available versions: 2.0.0, 1.9.0\n",
        name: "langwatch",
      }),
    ).toBe("2.0.0");
  });

  /**
   * The one that matters: a shape nobody recognises must not read as an
   * answer. A scenario standing on "pip reaches nothing usable" cannot tell
   * an unparsed output from a dead premise, so null has to mean null.
   */
  it("answers null when the output says nothing about versions", () => {
    expect(
      parseReachableVersion({
        output: "ERROR: No matching distribution\n",
        name: "langwatch",
      }),
    ).toBeNull();
  });

  it("does not take another package's header", () => {
    expect(
      parseReachableVersion({
        output: "langwatch-nlp (9.9.9)\n",
        name: "langwatch",
      }),
    ).toBeNull();
  });
});

describe("belowVersion", () => {
  it("compares numbers, not text", () => {
    expect(belowVersion("0.1.32", "1.3.0")).toBe(true);
    expect(belowVersion("0.9.0", "0.10.0")).toBe(true);
    expect(belowVersion("1.4.0", "1.3.0")).toBe(false);
  });

  it("is false for the floor itself", () => {
    expect(belowVersion("1.3.0", "1.3.0")).toBe(false);
  });

  it("treats a missing segment as zero", () => {
    expect(belowVersion("1.3", "1.3.0")).toBe(false);
    expect(belowVersion("1.3", "1.3.1")).toBe(true);
  });
});

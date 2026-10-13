import { afterAll, describe, expect, it } from "vitest";

import { cognitiveComplexityRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, options = []) {
  return runRule(cognitiveComplexityRule, { code, cwd: workspace.cwd, filename: "x.ts", options });
}

function ifChain(depth) {
  let body = "return 0;";
  for (let index = 0; index < depth; index += 1) {
    body = `if (a${index}) { ${body} } else { ${body} }`;
  }
  return `export function deep(${Array.from({ length: depth }, (_, i) => `a${i}`).join(", ")}) { ${body} }`;
}

describe("given a function", () => {
  describe("when its cognitive complexity passes the default maximum", () => {
    /** @scenario "A function past the complexity maximum is reported with its name and score" */
    it("reports tooComplex naming the function", () => {
      const found = report(ifChain(6));

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("tooComplex");
      expect(found[0].data.name).toBe("deep");
    });
  });

  describe("when the fix names where the extracted block goes", () => {
    /** @scenario "The fix sends the extracted block to module level" */
    it("says module-level, because a nested closure still counts toward the parent", () => {
      const found = report(`const a = 1;\n${ifChain(6)}`);

      expect(found.map((entry) => entry.line)).toEqual([2]);
      expect(found[0].message).toContain(
        "into a module-level function (a nested closure still counts toward `deep`)",
      );
    });
  });

  describe("when it sits at or under the maximum", () => {
    /** @scenario "A simple function is left alone" */
    it("reports nothing", () => {
      expect(report("export function simple(a) { if (a) { return 1; } return 0; }")).toEqual([]);
    });
  });

  describe("when the caller lowers the max option", () => {
    /** @scenario "The max option lowers the threshold the rule measures against" */
    it("reports a function that would otherwise pass", () => {
      const found = report("export function simple(a) { if (a) { return 1; } return 0; }", [
        { max: 0 },
      ]);

      expect(found).toHaveLength(1);
      expect(found[0].data.max).toBe(0);
    });
  });

  describe("when the score is spread over many nested constructs", () => {
    // The shape this rule got wrong: a poll loop scoring 25, with five
    // constructs tied at delta 3. Attribution by single-node delta named
    // whichever the walk reached first -- the `spent ? null : approval`
    // ternary, carrying 3 -- while the if/else chain carrying 11 of the 25
    // went unmentioned, so the prescribed extraction removed almost nothing.
    const pollLoop = `
      export async function pollUntilDone(opts, dc) {
        let interval = 1;
        let signalled = false;
        let spent = false;
        for (;;) {
          if (now() > deadline) { throw new Error("expired"); }
          if (firstPoll) { firstPoll = false; }
          else if (signalled && !spent) { spent = true; }
          else {
            await waitForNextPoll({ ms: interval, approval: spent ? null : approval });
            if (signalled) spent = true;
          }
          try { return await exchange(opts, dc); }
          catch (err) {
            if (!(err instanceof FlowError)) throw err;
            if (err.kind === "pending") continue;
            if (err.kind === "slow_down") { interval = interval * 2; continue; }
            throw err;
          }
        }
      }`;

    /** @scenario "The block carrying the most of the score is named, not a leaf that ties on its own delta" */
    it("names the block carrying the largest share and reports that share", () => {
      const found = report(pollLoop);

      expect(found).toHaveLength(1);
      expect(found[0].data.construct).toBe("if/else chain");
      expect(found[0].data.share).toBe("11 of 25");
    });

    /** @scenario "A block accounting for the whole score is never the named target" */
    it("names a block inside the loop rather than the loop itself", () => {
      const found = report(pollLoop);

      expect(found[0].data.construct).not.toBe("for loop");
    });
  });

  describe("when no single block carries a third of the score", () => {
    /** @scenario "A score with no dominant block is reported as spread rather than given a target" */
    it("reports tooComplexSpread and asks for the nesting to come down", () => {
      const flat = `export function wide(a) {
        ${Array.from({ length: 16 }, (_, i) => `if (a${i}) { return ${i}; }`).join("\n")}
        return -1;
      }`;

      const found = report(flat);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("tooComplexSpread");
    });
  });
});

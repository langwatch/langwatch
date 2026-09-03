import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { listNativeSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/langy/langy-code-access.feature: the code-changes skill is what
// tells Langy when a request needs the customer's code and when the platform
// alone can do the work. The decision table is that answer, so it is tested
// row by row rather than left to the model's reading.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

function codeChangesSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "code-changes");
  expect(skill, "code-changes is a shipped native skill").toBeTruthy();
  return renderSkill(skill!);
}

/** The decision table rows, as "| request | yes-or-no | reason |". */
function decisionRows(rendered: string): { request: string; needsCode: string }[] {
  return rendered
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 3 && (cells[1] === "yes" || cells[1] === "no"))
    .map((cells) => ({ request: cells[0]!.toLowerCase(), needsCode: cells[1]! }));
}

function verdictFor(rows: { request: string; needsCode: string }[], phrase: string): string {
  const row = rows.find((candidate) => candidate.request.includes(phrase));
  expect(row, `the decision table names "${phrase}"`).toBeTruthy();
  return row!.needsCode;
}

describe("the code-changes skill", () => {
  describe("given its decision table is read", () => {
    /** @scenario "The skill names the work that needs code and the work that does not" */
    it("marks the work in the customer's program as needing code and the platform work as not", () => {
      const rendered = codeChangesSkill();
      const rows = decisionRows(rendered);
      expect(rows.length).toBeGreaterThan(3);

      expect(verdictFor(rows, "instrument tracing")).toBe("yes");
      expect(verdictFor(rows, "wire the sdk")).toBe("yes");
      expect(verdictFor(rows, "fix the agent behind a failing scenario")).toBe("yes");
      expect(verdictFor(rows, "run parameter on a connected agent")).toBe("yes");
      expect(verdictFor(rows, "version a hardcoded prompt")).toBe("yes");

      expect(verdictFor(rows, "create or edit a scenario")).toBe("no");
      expect(verdictFor(rows, "evaluator")).toBe("no");
      expect(verdictFor(rows, "prompt version")).toBe("no");
      expect(verdictFor(rows, "read traces")).toBe("no");

      expect(rendered).toContain("do the platform work and never ask for code access");
      expect(rendered).toContain("code_access");
    });
  });
});

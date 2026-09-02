/**
 * Langy's prompt carries a table routing common intents to skills. Every skill
 * it names has to be one the worker actually gets.
 *
 * A row for a skill that is not in the tree is an instruction to call something
 * that is not there: the `skill` tool fails, and the turn spends a retry on a
 * name the prompt invented. The reverse is fine and expected, since the table
 * is a shortcut rather than an inventory and the prompt says so; the harness
 * injects the full list into every turn under `<available_skills>`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const langyagent = path.resolve(here, "../../../../../../../../../../services/langyagent/internal");
const promptPath = path.join(langyagent, "assets/AGENTS.md");
const skillsDir = path.join(langyagent, "assets/skills");

/** Table cells that name a routing target rather than a skill. */
const NON_SKILL_TARGETS = ["direct CLI"];

function skillsNamedInPromptTable(prompt: string): string[] {
  const start = prompt.indexOf("## Skills");
  const end = prompt.indexOf("## Replies");
  // Both headings, in this order, or the slice silently widens to a suffix of
  // the prompt and this check starts parsing prose that is not the table.
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      "the prompt no longer has a Skills section followed by a Replies section",
    );
  }
  const table = prompt.slice(start, end);
  const named = new Set<string>();
  for (const line of table.split("\n")) {
    const cells = line.split("|");
    if (cells.length < 4) continue;
    const target = cells[2]!.trim();
    if (NON_SKILL_TARGETS.includes(target)) continue;
    const match = /`([a-z0-9-]+)`/.exec(target);
    if (match) named.add(match[1]!);
  }
  return [...named];
}

describe("given Langy's prompt routes intents to skills", () => {
  const prompt = fs.readFileSync(promptPath, "utf8");
  const shipped = new Set(
    fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  describe("when each named skill is looked for in the shipped tree", () => {
    /** @scenario Every skill the prompt routes to is one the worker has */
    it("finds all of them", () => {
      const named = skillsNamedInPromptTable(prompt);
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((name) => !shipped.has(name))).toEqual([]);
    });
  });
});

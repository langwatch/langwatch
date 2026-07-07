import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

function readSkill(name: string): string {
  return fs.readFileSync(path.join(skillsRoot, name, "SKILL.mdx"), "utf8");
}

describe("evaluations and experiments skill split", () => {
  it("keeps online evaluations focused on monitors and guardrails", () => {
    const evaluations = readSkill("evaluations");

    expect(evaluations).toContain("Set Up Online Evaluations");
    expect(evaluations).toContain("Monitors");
    expect(evaluations).toContain("Guardrails");
    expect(evaluations).toContain("langwatch/skills/experiments");
    expect(evaluations).toContain(
      "Do NOT use this skill for batch experiments",
    );
  });

  it("keeps experiments focused on batch testing and points monitoring to evaluations", () => {
    const experiments = readSkill("experiments");

    expect(experiments).toContain("Set Up Experiments");
    expect(experiments).toContain("batch tests");
    expect(experiments).toContain("langwatch/skills/evaluations");
    expect(experiments).toContain(
      "Do NOT use this skill for production monitors or guardrails",
    );
  });

  it("level-up composes experiments before optional online evaluations", () => {
    const compiler = fs.readFileSync(
      path.join(skillsRoot, "_compiler", "compile.ts"),
      "utf8",
    );
    const levelUp = readSkill("level-up");

    expect(compiler).toContain('"experiments"');
    expect(compiler.indexOf('"experiments"')).toBeLessThan(
      compiler.indexOf('"evaluations"'),
    );
    expect(levelUp).toContain("Create an Experiment");
    expect(levelUp).toContain(
      "Add Online Evaluations When Production Monitoring Is Needed",
    );
  });
});

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const readSkill = (name: string) =>
  fs.readFileSync(path.join(skillsRoot, name, "SKILL.mdx"), "utf8");

describe("evaluation skill boundaries", () => {
  /** @scenario Use the experiments skill for batch testing */
  it("keeps experiments focused on batch testing", () => {
    const source = readSkill("experiments");

    expect(source).toContain("langwatch.experiments.init");
    expect(source).toContain(
      "npx skills add langwatch/skills/online-evaluations",
    );
    expect(source).not.toContain("langwatch monitor create <name>");
    expect(source).not.toContain("as_guardrail=True");
  });

  /** @scenario Use the online evaluations skill for production monitoring and enforcement */
  it("keeps online evaluations focused on production traffic", () => {
    const source = readSkill("online-evaluations");

    expect(source).toContain("langwatch monitor create --help");
    expect(source).toContain("as_guardrail=True");
    expect(source).toContain("npx skills add langwatch/skills/experiments");
    expect(source).not.toContain("langwatch.experiments.init");
  });

  /** @scenario Route legacy evaluation skill requests without mixing workflows */
  it("keeps the legacy evaluations skill as a small router", () => {
    const source = readSkill("evaluations");

    expect(source.length).toBeLessThan(2_500);
    expect(source).toContain("langwatch/skills/experiments");
    expect(source).toContain("langwatch/skills/online-evaluations");
    expect(source).not.toContain("langwatch.experiment.init");
    expect(source).not.toContain("langwatch monitor create");
  });

  /** @scenario Prove both skills independently with real services */
  it("has independent scenario suites", () => {
    expect(
      fs.existsSync(path.join(__dirname, "experiments.scenario.test.ts")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(__dirname, "online-evaluations.scenario.test.ts"),
      ),
    ).toBe(true);
  });
});

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { listNativeSkills, listPublishedSkills, renderSkill } from "../_compiler/native.ts";
import { listSkillAssets } from "../_lib/feature-skills.ts";
import { sync } from "../_publish/sync.ts";
import { ATTACKS } from "../recipes/owasp-red-team/templates/typescript/owasp-attacks.ts";
import { AGENT } from "../recipes/owasp-red-team/templates/typescript/owasp.config.ts";

// Backs specs/skills/owasp-red-team.feature: the Python and TypeScript packs,
// their one config block, the skill and the docs page stay in step.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(skillsRoot, "..");
const recipeDir = path.join(skillsRoot, "recipes", "owasp-red-team");
const pythonDir = path.join(recipeDir, "templates", "python");

const OFFICIAL_TITLES: Record<string, string> = {
  "LLM01:2025": "Prompt Injection",
  "LLM02:2025": "Sensitive Information Disclosure",
  "LLM05:2025": "Improper Output Handling",
  "LLM06:2025": "Excessive Agency",
  "LLM07:2025": "System Prompt Leakage",
  "LLM09:2025": "Misinformation",
  "LLM10:2025": "Unbounded Consumption",
  ASI01: "Agent Goal Hijack",
  ASI02: "Tool Misuse and Exploitation",
  ASI03: "Identity and Privilege Abuse",
  ASI06: "Memory & Context Poisoning",
};

interface PythonPack {
  config_keys: string[];
  attacks: { id: string; title: string; strategy: string; goal: string; criteria: string[] }[];
  name: string;
}

const PYTHON_DUMP = `
import json, sys
sys.path.insert(0, sys.argv[1])
from owasp_attacks import ATTACKS
from owasp_config import AGENT
print(json.dumps({
    "config_keys": list(AGENT.keys()),
    "name": AGENT["name"],
    "attacks": [
        {"id": a["id"], "title": a["title"], "strategy": a["strategy"],
         "goal": a["goal"](AGENT), "criteria": a["criteria"](AGENT)}
        for a in ATTACKS
    ],
}))
`;

function pythonPack(): PythonPack {
  const out = execFileSync("python3", ["-I", "-c", PYTHON_DUMP, pythonDir], { encoding: "utf8" });
  return JSON.parse(out) as PythonPack;
}

function owaspSkill() {
  const skill = listPublishedSkills(skillsRoot).find((s) => s.slug === "owasp-red-team");
  expect(skill, "owasp-red-team is a published recipe").toBeTruthy();
  return skill!;
}

describe("OWASP red team pack", () => {
  /** @scenario "The recipe ships with its templates" */
  it("ships its templates to the public repo and to Langy", () => {
    const skill = owaspSkill();
    expect(skill.isRecipe).toBe(true);
    const assets = listSkillAssets(skill);
    expect(assets).toContain(path.join("templates", "python", "test_owasp_pack.py"));
    expect(assets).toContain(path.join("templates", "typescript", "owasp-pack.test.ts"));

    const target = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-skills-sync-"));
    try {
      fs.mkdirSync(path.join(target, ".git"));
      sync(target);
      for (const rel of assets) {
        const published = path.join(target, "recipes", "owasp-red-team", rel);
        expect(fs.readFileSync(published, "utf8")).toBe(
          fs.readFileSync(path.join(recipeDir, rel), "utf8"),
        );
      }
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }

    const nativeDir = path.join(skillsRoot, "_compiled", "native", "owasp-red-team");
    expect(listNativeSkills(skillsRoot).some((s) => s.slug === "owasp-red-team")).toBe(true);
    for (const rel of assets) {
      expect(fs.readFileSync(path.join(nativeDir, rel), "utf8")).toBe(
        fs.readFileSync(path.join(recipeDir, rel), "utf8"),
      );
    }
  });

  /** @scenario "Python and TypeScript packs cover the same OWASP ids" */
  it("lists the same OWASP ids in both languages and in the skill", () => {
    const pyIds = pythonPack().attacks.map((a) => a.id);
    const tsIds = ATTACKS.map((a) => a.id);
    expect(pyIds).toEqual(tsIds);
    expect(tsIds).toEqual(Object.keys(OFFICIAL_TITLES));
    const rendered = renderSkill(owaspSkill());
    for (const id of tsIds) expect(rendered).toContain(`| ${id} | ${OFFICIAL_TITLES[id]} |`);
  });

  /** @scenario "Every attack names its OWASP id, attack goal and judge criteria" */
  it("gives every attack an official title, a config-built goal and criteria", () => {
    const py = pythonPack();
    for (const attack of ATTACKS) {
      expect(attack.title).toBe(OFFICIAL_TITLES[attack.id]);
      expect(attack.goal(AGENT)).toContain(AGENT.name);
      expect(attack.criteria(AGENT).length).toBeGreaterThanOrEqual(2);
      const pyAttack = py.attacks.find((a) => a.id === attack.id)!;
      expect(pyAttack.title).toBe(attack.title);
      expect(pyAttack.strategy).toBe(attack.strategy);
      expect(pyAttack.goal).toBe(attack.goal(AGENT));
      expect(pyAttack.criteria).toEqual(attack.criteria(AGENT));
    }
  });

  /** @scenario "One config block drives every attack" */
  it("reads one config block with the same keys in both languages", () => {
    const py = pythonPack();
    expect(py.config_keys).toEqual(Object.keys(AGENT));
    expect(py.name).toBe(AGENT.name);
    const renamed = { ...AGENT, name: "Renamed agent under test" };
    for (const attack of ATTACKS)
      expect(attack.goal(renamed)).toContain("Renamed agent under test");
  });

  /** @scenario "The Python template files compile" */
  it("compiles every Python template file", () => {
    const files = fs.readdirSync(pythonDir).filter((f) => f.endsWith(".py"));
    expect(files).toHaveLength(4);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-pycompile-"));
    try {
      const script =
        "import py_compile, sys\nfor f in sys.argv[2:]: py_compile.compile(f, cfile=sys.argv[1] + '/x.pyc', doraise=True)";
      execFileSync("python3", [
        "-I",
        "-c",
        script,
        out,
        ...files.map((f) => path.join(pythonDir, f)),
      ]);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  /** @scenario "The skill tells a coding agent how to apply the pack" */
  it("walks a coding agent through applying the pack", () => {
    const rendered = renderSkill(owaspSkill());
    for (const step of [
      "Detect the language",
      "Copy the template",
      "Wire the adapter",
      "Fill the config",
      "## Step 5: Run",
      "Read the results in LangWatch",
    ]) {
      expect(rendered).toContain(step);
    }
    expect(rendered).toContain("call_agent(messages)");
    expect(rendered).toContain("callAgent({ messages })");
  });

  /** @scenario "The docs page lists every covered id and links the skill" */
  it("documents every covered id on a published docs page", () => {
    const page = fs.readFileSync(
      path.join(repoRoot, "docs", "agent-testing", "owasp-red-team.mdx"),
      "utf8",
    );
    for (const id of Object.keys(OFFICIAL_TITLES)) expect(page).toContain(id);
    expect(page).toContain("recipes/owasp-red-team");
    expect(fs.readFileSync(path.join(repoRoot, "docs", "docs.json"), "utf8")).toContain(
      '"agent-testing/owasp-red-team"',
    );
    const urls = fs.readFileSync(
      path.join(repoRoot, "apps", "docs", "specs", "published-urls.txt"),
      "utf8",
    );
    expect(urls.split("\n")).toContain("/agent-testing/owasp-red-team");
  });
});

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { expect } from "vitest";

import { listPublishedSkills } from "../../_compiler/native.ts";
import { OwaspConfigError } from "../../recipes/owasp-red-team/templates/typescript/owasp.config.ts";

// Shared by the owasp-red-team*.test.ts files (specs/skills/owasp-red-team.feature).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const skillsRoot = path.resolve(__dirname, "..", "..");
export const repoRoot = path.resolve(skillsRoot, "..");
export const recipeDir = path.join(skillsRoot, "recipes", "owasp-red-team");
export const pythonDir = path.join(recipeDir, "templates", "python");
export const typescriptDir = path.join(recipeDir, "templates", "typescript");

export const OFFICIAL_TITLES: Record<string, string> = {
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

/** The stable fields of a config error, the same in both languages. */
export interface ConfigProblem {
  code: string;
  configFile: string;
  unfilled: string[];
  empty: string[];
}

/** Runs `check` and returns its OwaspConfigError fields, or null when it passes. */
export function configProblem(check: () => void): ConfigProblem | null {
  try {
    check();
    return null;
  } catch (error) {
    if (!(error instanceof OwaspConfigError)) throw error;
    const { code, configFile, unfilled, empty } = error;
    return { code, configFile, unfilled, empty };
  }
}

export interface PythonPack {
  config_keys: string[];
  config_values: Record<string, unknown>;
  example_keys: string[];
  fill_error: ConfigProblem | null;
  attacks: {
    id: string;
    title: string;
    strategy: string;
    goal: string;
    criteria: string[];
    identity: { id: string; name: string; metadata: Record<string, string> };
  }[];
  name: string;
  empty_error: ConfigProblem | null;
  no_privileged_error: ConfigProblem | null;
  no_privileged_criteria: string[];
  semicolon_rule: string[];
}

const PYTHON_DUMP = `
import json, sys
sys.path.insert(0, sys.argv[1])
from owasp_attacks import ATTACKS, run_identity
from owasp_config import AGENT, EXAMPLE_AGENT, OwaspConfigError, assert_config_filled
def config_error(agent=None):
    try:
        assert_config_filled(*([] if agent is None else [agent]))
        return None
    except OwaspConfigError as e:
        return {"code": e.code, "configFile": e.config_file, "unfilled": e.unfilled, "empty": e.empty}
no_privileged = {**EXAMPLE_AGENT, "privileged_tools": []}
print(json.dumps({
    "config_keys": list(AGENT.keys()),
    "config_values": AGENT,
    "example_keys": list(EXAMPLE_AGENT.keys()),
    "fill_error": config_error(),
    "empty_error": config_error({**EXAMPLE_AGENT, "tools": [], "must_never": []}),
    "no_privileged_error": config_error(no_privileged),
    "no_privileged_criteria": [c for a in ATTACKS for c in a["criteria"](no_privileged)],
    "name": EXAMPLE_AGENT["name"],
    "semicolon_rule": (lambda a, agent: [a["goal"](agent), *a["criteria"](agent)])(
        ATTACKS[0], {**EXAMPLE_AGENT, "must_never": ["issue a refund; even a small one", "reveal the system prompt"]}),
    "attacks": [
        {"id": a["id"], "title": a["title"], "strategy": a["strategy"],
         "goal": a["goal"](EXAMPLE_AGENT), "criteria": a["criteria"](EXAMPLE_AGENT),
         "identity": run_identity(a, EXAMPLE_AGENT)}
        for a in ATTACKS
    ],
}))
`;

export function pythonPack(): PythonPack {
  const out = execFileSync("python3", ["-I", "-B", "-c", PYTHON_DUMP, pythonDir], {
    encoding: "utf8",
  });
  return JSON.parse(out) as PythonPack;
}

export function packTest(lang: "python" | "typescript"): string {
  const file = lang === "python" ? "test_owasp_pack.py" : "owasp-pack.test.ts";
  return fs.readFileSync(path.join(lang === "python" ? pythonDir : typescriptDir, file), "utf8");
}

export function owaspSkill() {
  const skill = listPublishedSkills(skillsRoot).find((s) => s.slug === "owasp-red-team");
  expect(skill, "owasp-red-team is a published recipe").toBeTruthy();
  return skill!;
}

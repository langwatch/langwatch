import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
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

const e2eDir = path.join(__dirname, "..", "fixtures", "owasp-e2e");

/** How one end-to-end run of a pack ended: a failure message per attack, null when it held. */
export interface PackRun {
  outcomes: { id: string; failure: string | null }[];
  /** An error that stopped the whole suite before any attack ran. */
  suiteError: string | null;
}

export interface PackRunInput {
  config: "shipped" | "example";
  verdict: "held" | "breach";
}

/** Runs the Python pack's test function with stub pytest and scenario modules. */
export function runPythonPack({ config, verdict }: PackRunInput): PackRun & {
  runs: { name: string; set_id: string; metadata: Record<string, string>; reply: string }[];
  marks: string[];
} {
  const out = execFileSync(
    "python3",
    ["-I", "-B", path.join(e2eDir, "run_python_pack.py"), pythonDir, config, verdict],
    { encoding: "utf8" },
  );
  return { suiteError: null, ...JSON.parse(out) };
}

interface VitestReport {
  success: boolean;
  numFailedTests: number;
  testResults: {
    assertionResults: { title: string; status: string; failureMessages: string[] }[];
  }[];
}

/** Runs a command and resolves its stdout and stderr once it exits. */
function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(output));
  });
}

/** Runs the TypeScript pack on the real scenario SDK with a stub model (fixtures/owasp-e2e). */
export async function runTypescriptPack({ config, verdict }: PackRunInput): Promise<PackRun> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-ts-e2e-"));
  const outputFile = path.join(outDir, "report.json");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("VITEST") && key !== "LANGWATCH_API_KEY",
    ),
  );
  try {
    const vitest = await run(
      path.join(skillsRoot, "node_modules", ".bin", "vitest"),
      [
        "run",
        "--config",
        path.join(e2eDir, "vitest.config.ts"),
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${outputFile}`,
      ],
      {
        // The SDK writes a redteam-reports folder into the working directory.
        cwd: outDir,
        // CI forces colour, which splits the error text the tests match with escape codes.
        env: {
          ...env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          OWASP_E2E_CONFIG: config,
          OWASP_E2E_VERDICT: verdict,
        },
      },
    );
    const report = JSON.parse(fs.readFileSync(outputFile, "utf8")) as VitestReport;
    const [file] = report.testResults;
    // The JSON report drops a failed beforeAll, so a suite error comes from the console report.
    const suiteFailed = !report.success && report.numFailedTests === 0;
    return {
      suiteError: suiteFailed ? vitest : null,
      outcomes: (file?.assertionResults ?? []).map((a) => ({
        id: a.title.split(" ")[0]!,
        failure: a.status === "passed" ? null : a.failureMessages.join("\n") || a.status,
      })),
    };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

export function owaspSkill() {
  const skill = listPublishedSkills(skillsRoot).find((s) => s.slug === "owasp-red-team");
  expect(skill, "owasp-red-team is a published recipe").toBeTruthy();
  return skill!;
}

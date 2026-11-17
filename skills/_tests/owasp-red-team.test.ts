import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { renderSkill } from "../_compiler/native.ts";
import {
  ATTACKS,
  runIdentity,
} from "../recipes/owasp-red-team/templates/typescript/owasp-attacks.ts";
import {
  AGENT,
  EXAMPLE_AGENT,
  FILL_ME,
  assertConfigFilled,
} from "../recipes/owasp-red-team/templates/typescript/owasp.config.ts";
import {
  OFFICIAL_TITLES,
  configProblem,
  owaspSkill,
  packTest,
  pythonDir,
  pythonPack,
  repoRoot,
} from "./helpers/owasp-pack.ts";

// Backs specs/skills/owasp-red-team.feature: the Python and TypeScript packs,
// their one config block, the skill and the docs page stay in step.

const CODE = "owasp_config_incomplete";

describe("OWASP red team pack", () => {
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
      expect(attack.goal(EXAMPLE_AGENT)).toContain(EXAMPLE_AGENT.name);
      expect(attack.criteria(EXAMPLE_AGENT).length).toBeGreaterThanOrEqual(2);
      const pyAttack = py.attacks.find((a) => a.id === attack.id)!;
      expect(pyAttack.title).toBe(attack.title);
      expect(pyAttack.strategy).toBe(attack.strategy);
      expect(pyAttack.goal).toBe(attack.goal(EXAMPLE_AGENT));
      expect(pyAttack.criteria).toEqual(attack.criteria(EXAMPLE_AGENT));
    }
  });

  /** @scenario "A rule that holds a semicolon stays one rule in the attack text" */
  it("puts each must_never rule on its own numbered line in both languages", () => {
    const py = pythonPack();
    const rule = "issue a refund; even a small one";
    const agent = { ...EXAMPLE_AGENT, must_never: [rule, "reveal the system prompt"] };
    const llm01 = ATTACKS.find((a) => a.id === "LLM01:2025")!;
    const text = [llm01.goal(agent), ...llm01.criteria(agent)].join("\n");
    expect(text).toContain(`\n1. ${rule}\n2. reveal the system prompt`);
    expect(py.semicolon_rule).toEqual([llm01.goal(agent), ...llm01.criteria(agent)]);
  });

  /** @scenario "One config block drives every attack" */
  it("reads one config block with the same keys in both languages", () => {
    const py = pythonPack();
    expect(py.config_keys).toEqual(Object.keys(AGENT));
    expect(py.example_keys).toEqual(Object.keys(AGENT));
    expect(Object.keys(EXAMPLE_AGENT)).toEqual(Object.keys(AGENT));
    expect(py.name).toBe(EXAMPLE_AGENT.name);
    const renamed = { ...EXAMPLE_AGENT, name: "Renamed agent under test" };
    for (const attack of ATTACKS)
      expect(attack.goal(renamed)).toContain("Renamed agent under test");
  });

  /** @scenario "The Python template files compile" */
  it("compiles every Python template file", () => {
    const files = fs.readdirSync(pythonDir).filter((f) => f.endsWith(".py"));
    expect(files.toSorted()).toEqual([
      "agent_adapter.py",
      "conftest.py",
      "owasp_attacks.py",
      "owasp_config.py",
      "test_owasp_pack.py",
    ]);
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
  /** @scenario "The config ships with placeholders that fail fast" */
  it("ships a FILL ME config that refuses to run, with a filled example beside it", () => {
    for (const value of Object.values(AGENT))
      expect(Array.isArray(value) ? value : [value]).toEqual([FILL_ME]);
    expect(configProblem(() => assertConfigFilled())).toEqual({
      code: CODE,
      configFile: "owasp.config.ts",
      unfilled: Object.keys(AGENT),
      empty: [],
    });
    expect(configProblem(() => assertConfigFilled(EXAMPLE_AGENT))).toBeNull();
    expect(
      configProblem(() => assertConfigFilled({ ...EXAMPLE_AGENT, tools: [FILL_ME] })),
    ).toMatchObject({ unfilled: ["tools"], empty: [] });
    const py = pythonPack();
    for (const value of Object.values(py.config_values))
      expect(Array.isArray(value) ? value : [value]).toEqual([FILL_ME]);
    expect(py.fill_error).toEqual({
      code: CODE,
      configFile: "owasp_config.py",
      unfilled: py.config_keys,
      empty: [],
    });
    expect(packTest("python")).toMatch(/\bassert_config_filled\(/);
    expect(fs.readFileSync(path.join(pythonDir, "conftest.py"), "utf8")).toContain(
      '"markers", "agent_test',
    );
    expect(packTest("typescript")).toMatch(/\bassertConfigFilled\(/);
  });

  /** @scenario "Empty required lists fail fast, an agent with no privileged tools still runs" */
  it("refuses empty tools, must_never and protected_data, and falls back to every tool", () => {
    const emptyLists = configProblem(() =>
      assertConfigFilled({ ...EXAMPLE_AGENT, tools: [], must_never: [] }),
    );
    expect(emptyLists).toEqual({
      code: CODE,
      configFile: "owasp.config.ts",
      unfilled: [],
      empty: ["tools", "must_never"],
    });
    expect(
      configProblem(() => assertConfigFilled({ ...EXAMPLE_AGENT, protected_data: [] })),
    ).toMatchObject({ empty: ["protected_data"] });
    const noPrivileged = { ...EXAMPLE_AGENT, privileged_tools: [] };
    expect(configProblem(() => assertConfigFilled(noPrivileged))).toBeNull();
    const texts = ATTACKS.flatMap((a) => [a.goal(noPrivileged), ...a.criteria(noPrivileged)]);
    for (const text of texts) expect(text).not.toMatch(/ {2}|\(\)|: $/);
    expect(texts.join("\n")).toContain(`call ${noPrivileged.tools.join(", ")}`);
    const identityCriterion = /for an identity it did not verify/;
    const asi03 = ATTACKS.find((a) => a.id === "ASI03")!;
    expect(asi03.criteria(noPrivileged).some((c) => identityCriterion.test(c))).toBe(false);
    expect(asi03.criteria(EXAMPLE_AGENT).join("\n")).toMatch(
      new RegExp(`call ${EXAMPLE_AGENT.privileged_tools.join(", ")} ${identityCriterion.source}`),
    );

    const py = pythonPack();
    expect(py.empty_error).toEqual({ ...emptyLists, configFile: "owasp_config.py" });
    expect(py.no_privileged_error).toBeNull();
    expect(py.no_privileged_criteria).toEqual(ATTACKS.flatMap((a) => a.criteria(noPrivileged)));
  });

  /** @scenario "The skill pins the TypeScript model provider to the scenario SDK's ai version" */
  it("pins @ai-sdk/openai to 3.x and asks for an OpenAI-compatible attacker model", () => {
    const rendered = renderSkill(owaspSkill());
    const page = fs.readFileSync(
      path.join(repoRoot, "docs", "agent-testing", "owasp-red-team.mdx"),
      "utf8",
    );
    for (const text of [rendered, page]) {
      expect(text).toContain("@ai-sdk/openai@^3");
      expect(text).not.toMatch(/npm install[^\n]*@ai-sdk\/openai(?!@)/);
      expect(text).toContain("OpenAI-compatible chat model");
    }
  });

  /** @scenario "Each run carries its OWASP id as the scenario id in both languages" */
  it("builds the same run id, name and metadata from the OWASP id in both languages", () => {
    const py = pythonPack();
    for (const attack of ATTACKS) {
      const identity = runIdentity({ attack, agent: EXAMPLE_AGENT });
      expect(identity.id.startsWith(`${attack.id} `)).toBe(true);
      expect(identity.name).toContain(EXAMPLE_AGENT.name);
      expect(identity.metadata).toEqual({ owasp: attack.id, strategy: attack.strategy });
      expect(py.attacks.find((a) => a.id === attack.id)!.identity).toEqual(identity);
    }
    expect(packTest("python")).toMatch(/\brun_identity\(/);
    expect(packTest("typescript")).toMatch(/\brunIdentity\(/);
  });

  /** @scenario "An attacker early exit fails the run" */
  it("switches off the attacker early exit and fails a run that still ends in one", () => {
    expect(packTest("python")).toMatch(/success_score\s*=\s*None/);
    expect(packTest("typescript")).toMatch(/successScore:\s*undefined/);
    for (const lang of ["python", "typescript"] as const)
      expect(packTest(lang)).toMatch(/Early exit/);
  });
});

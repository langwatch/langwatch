import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";

import { renderSkill } from "../_compiler/native.ts";
import {
  ATTACKS,
  attackerOptions,
  breach,
  runIdentity,
} from "../recipes/owasp-red-team/templates/typescript/owasp-attacks.ts";
import {
  AGENT,
  EXAMPLE_AGENT,
  FILL_ME,
  OwaspTurnsError,
  assertConfigFilled,
  modelId,
  parseTurns,
} from "../recipes/owasp-red-team/templates/typescript/owasp.config.ts";
import packVitestConfig from "../recipes/owasp-red-team/templates/typescript/owasp.vitest.config.ts";
import {
  OFFICIAL_TITLES,
  type PackRun,
  type PackRunInput,
  configProblem,
  owaspSkill,
  pythonDir,
  pythonPack,
  repoRoot,
  runPythonPack,
  runTypescriptPack,
} from "./helpers/owasp-pack.ts";

// Backs specs/skills/owasp-red-team.feature: the Python and TypeScript packs,
// their one config block, the skill and the docs page stay in step.

const CODE = "owasp_config_incomplete";
const LIMITS = { max_reply_words: 500, max_tool_calls_per_turn: 5 };

const PY_TURNS = `
import json, sys
sys.path.insert(0, sys.argv[1])
from owasp_config import OwaspTurnsError, parse_turns
out = {}
for raw in sys.argv[2:]:
    try:
        out[raw] = parse_turns(raw)
    except OwaspTurnsError as e:
        out[raw] = {"code": e.code, "message": str(e)}
print(json.dumps({"unset": parse_turns(None), **out}))
`;

const PY_CONFTEST = `
import json, sys
sys.path.insert(0, sys.argv[1])
import conftest
class Config:
    lines = []
    def addinivalue_line(self, name, line):
        self.lines.append([name, line])
config = Config()
conftest.pytest_configure(config)
print(json.dumps(config.lines))
`;

const PY_BREACH = `
import json, sys, types
sys.path.insert(0, sys.argv[1])
from owasp_attacks import breach
cases = json.loads(sys.argv[2])
print(json.dumps([breach("X", types.SimpleNamespace(success=c["success"], reasoning=c.get("reasoning"),
    failed_criteria=c["unmetCriteria"])) for c in cases]))
`;

const TS_RUNS: PackRunInput[] = [
  { config: "shipped", verdict: "held" },
  { config: "example", verdict: "held" },
  { config: "example", verdict: "breach" },
];
const runKey = ({ config, verdict }: PackRunInput) => `${config}:${verdict}`;
let tsRuns: Promise<Map<string, PackRun>> | undefined;

/** A TypeScript run starts a vitest process, so all three start together on first use. */
async function packRun(lang: "python" | "typescript", input: PackRunInput): Promise<PackRun> {
  if (lang === "python") return runPythonPack(input);
  tsRuns ??= Promise.all(
    TS_RUNS.map(async (mode) => [runKey(mode), await runTypescriptPack(mode)] as const),
  ).then((entries) => new Map(entries));
  return (await tsRuns).get(runKey(input))!;
}

const E2E_TIMEOUT_MS = 120_000;

function tsTurns(raw: string | undefined): number | { code: string; message: string } {
  try {
    return parseTurns(raw);
  } catch (error) {
    if (!(error instanceof OwaspTurnsError)) throw error;
    return { code: error.code, message: error.message };
  }
}

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
    const { max_reply_words, max_tool_calls_per_turn, ...fillable } = AGENT;
    expect({ max_reply_words, max_tool_calls_per_turn }).toEqual(LIMITS);
    for (const value of Object.values(fillable))
      expect(Array.isArray(value) ? value : [value]).toEqual([FILL_ME]);
    expect(configProblem(() => assertConfigFilled())).toEqual({
      code: CODE,
      configFile: "owasp.config.ts",
      unfilled: Object.keys(fillable),
      empty: [],
    });
    expect(configProblem(() => assertConfigFilled(EXAMPLE_AGENT))).toBeNull();
    expect(
      configProblem(() => assertConfigFilled({ ...EXAMPLE_AGENT, tools: [FILL_ME] })),
    ).toMatchObject({ unfilled: ["tools"], empty: [] });
    const py = pythonPack();
    const pyValues = { ...py.config_values };
    expect({
      max_reply_words: pyValues.max_reply_words,
      max_tool_calls_per_turn: pyValues.max_tool_calls_per_turn,
    }).toEqual(LIMITS);
    delete pyValues.max_reply_words;
    delete pyValues.max_tool_calls_per_turn;
    for (const value of Object.values(pyValues))
      expect(Array.isArray(value) ? value : [value]).toEqual([FILL_ME]);
    expect(py.fill_error).toEqual({
      code: CODE,
      configFile: "owasp_config.py",
      unfilled: Object.keys(pyValues),
      empty: [],
    });
  });

  /** @scenario "The pack refuses to run on the shipped config" */
  it(
    "fails every attack with owasp_config_incomplete when run on the shipped config",
    async () => {
      const ids = ATTACKS.map((a) => a.id);
      const py = await packRun("python", { config: "shipped", verdict: "held" });
      expect(py.outcomes).toEqual(ids.map((id) => ({ id, failure: CODE })));
      const ts = await packRun("typescript", { config: "shipped", verdict: "held" });
      expect(ts.suiteError).toContain("OwaspConfigError: Fill AGENT in owasp.config.ts");
      expect(ts.outcomes.map((o) => o.id)).toEqual(ids);
      for (const outcome of ts.outcomes) expect(outcome.failure).not.toBeNull();
    },
    E2E_TIMEOUT_MS,
  );

  /** @scenario "The consumption attack judges against the configured limits" */
  it("builds the LLM10 criteria from max_reply_words and max_tool_calls_per_turn", () => {
    const agent = { ...EXAMPLE_AGENT, max_reply_words: 200, max_tool_calls_per_turn: 3 };
    const llm10 = ATTACKS.find((a) => a.id === "LLM10:2025")!;
    const criteria = llm10.criteria(agent).join("\n");
    expect(criteria).toContain("about 200 words");
    expect(criteria).toContain("more than 3 tool calls");
    expect(criteria).not.toMatch(/\b500\b|\b5 tool/);
    const py = execFileSync(
      "python3",
      [
        "-I",
        "-B",
        "-c",
        "import json, sys; sys.path.insert(0, sys.argv[1]); from owasp_attacks import ATTACKS; " +
          "from owasp_config import EXAMPLE_AGENT; a = next(x for x in ATTACKS if x['id'] == 'LLM10:2025'); " +
          "print(json.dumps(a['criteria']({**EXAMPLE_AGENT, 'max_reply_words': 200, 'max_tool_calls_per_turn': 3})))",
        pythonDir,
      ],
      { encoding: "utf8" },
    );
    expect(JSON.parse(py)).toEqual(llm10.criteria(agent));
  });

  /** @scenario "OWASP_TURNS falls back when empty and refuses a bad value" */
  it("parses OWASP_TURNS the same way in both languages", () => {
    const bad = ["abc", "0", "-3", "2.5"];
    const py = JSON.parse(
      execFileSync("python3", ["-I", "-B", "-c", PY_TURNS, pythonDir, "", "  ", "30", ...bad], {
        encoding: "utf8",
      }),
    ) as Record<string, unknown>;
    expect(tsTurns(undefined)).toBe(10);
    expect(py.unset).toBe(10);
    for (const raw of ["", "  "]) {
      expect(tsTurns(raw)).toBe(10);
      expect(py[raw]).toBe(10);
    }
    expect(tsTurns("30")).toBe(30);
    expect(py["30"]).toBe(30);
    for (const raw of bad) {
      for (const result of [tsTurns(raw), py[raw]]) {
        expect(result).toMatchObject({ code: "owasp_turns_invalid" });
        expect((result as { message: string }).message).toContain("OWASP_TURNS");
      }
    }
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
});

describe("OWASP red team pack runs", () => {
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
  });

  /** @scenario "Each run carries its OWASP id as the scenario id in both languages" */
  it(
    "names every end-to-end run after its OWASP id",
    async () => {
      const py = runPythonPack({ config: "example", verdict: "held" });
      expect(py.runs.map(({ name, set_id, metadata }) => ({ name, set_id, metadata }))).toEqual(
        ATTACKS.map((attack) => {
          const { name, metadata } = runIdentity({ attack, agent: EXAMPLE_AGENT });
          return { name, set_id: "owasp-red-team", metadata };
        }),
      );
      const ts = await packRun("typescript", { config: "example", verdict: "breach" });
      for (const attack of ATTACKS) {
        const { name } = runIdentity({ attack, agent: EXAMPLE_AGENT });
        const outcome = ts.outcomes.find((o) => o.id === attack.id);
        expect(outcome?.failure).toContain(`${name}. Unmet: `);
      }
    },
    E2E_TIMEOUT_MS,
  );

  /** @scenario "An attacker early exit fails the run" */
  it("switches off the attacker early exit and fails a run that still ends in one", () => {
    const options = attackerOptions({ attack: ATTACKS[0]!, agent: EXAMPLE_AGENT, turns: 3 });
    expect(Object.keys(options)).toContain("successScore");
    expect(options).toEqual({
      target: ATTACKS[0]!.goal(EXAMPLE_AGENT),
      totalTurns: 3,
      successScore: undefined,
    });
    const cases = [
      { success: true, reasoning: "Early exit: objective achieved on turn 3", unmetCriteria: [] },
      { success: false, reasoning: "Leaked a card number", unmetCriteria: ["a", "b"] },
      { success: true, reasoning: "Held", unmetCriteria: [] },
    ];
    const expected = [
      "X: the attacker won. Early exit: objective achieved on turn 3",
      "X. Unmet: a; b. Leaked a card number",
      null,
    ];
    expect(cases.map((result) => breach({ name: "X", result }))).toEqual(expected);
    const py = execFileSync(
      "python3",
      ["-I", "-B", "-c", PY_BREACH, pythonDir, JSON.stringify(cases)],
      { encoding: "utf8" },
    );
    expect(JSON.parse(py)).toEqual(expected);
  });

  /** @scenario "The pack runs end to end against a stub model" */
  it(
    "passes every attack the judge says held, even when the attacker scores a win, and fails every breach",
    async () => {
      for (const lang of ["python", "typescript"] as const) {
        const held = await packRun(lang, { config: "example", verdict: "held" });
        expect(held.suiteError, lang).toBeNull();
        expect(held.outcomes, lang).toEqual(ATTACKS.map(({ id }) => ({ id, failure: null })));
        const broken = await packRun(lang, { config: "example", verdict: "breach" });
        expect(
          broken.outcomes.map((o) => o.id),
          lang,
        ).toEqual(ATTACKS.map((a) => a.id));
        for (const outcome of broken.outcomes) expect(outcome.failure, lang).toContain("Unmet: ");
      }
      const py = runPythonPack({ config: "example", verdict: "held" });
      expect(py.runs.map((r) => r.reply)).toEqual(
        ATTACKS.map(() => "I can only help with your own orders."),
      );
    },
    E2E_TIMEOUT_MS,
  );

  /** @scenario "The judge checks security only, from what it can see" */
  it("judges security only, with criteria built from the config and the conversation", () => {
    const agent = { ...EXAMPLE_AGENT, output_rendered_as: "Slack messages" };
    const criteria = (id: string) => ATTACKS.find((a) => a.id === id)!.criteria(agent);
    const all = ATTACKS.flatMap((a) => a.criteria(agent)).join("\n");
    expect(all).not.toMatch(/still helps|explains what|offers|politely|plain text/);
    expect(all).not.toMatch(/its rules require|backed by its|its own instructions/);
    for (const text of criteria("LLM05:2025")) expect(text).toContain("Slack messages");
    for (const id of ["LLM06:2025", "LLM09:2025"]) {
      const text = criteria(id).join("\n");
      for (const rule of agent.must_never) expect(text).toContain(rule);
      expect(text).toContain("tool result");
    }
    expect(pythonPack().attacks.map((a) => a.criteria)).toEqual(
      ATTACKS.map((a) => a.criteria(EXAMPLE_AGENT)),
    );
  });

  /** @scenario "OWASP_MODEL takes the same LiteLLM id in both languages" */
  it("strips a LiteLLM provider prefix from OWASP_MODEL in TypeScript", () => {
    expect(modelId("openai/gpt-5-mini")).toBe("gpt-5-mini");
    expect(modelId("anthropic/claude-x")).toBe("claude-x");
    expect(modelId("gpt-5-mini")).toBe("gpt-5-mini");
    expect(modelId("meta-llama/Llama-4")).toBe("meta-llama/Llama-4");
    expect(modelId(undefined)).toBe("gpt-6-luna");
  });

  /** @scenario "The pack stays out of a default test run" */
  it("runs only when asked: a pytest mark and a vitest config of its own", () => {
    const py = runPythonPack({ config: "example", verdict: "held" });
    expect(py.marks).toContain("agent_test");
    const lines = JSON.parse(
      execFileSync("python3", ["-I", "-B", "-c", PY_CONFTEST, pythonDir], { encoding: "utf8" }),
    ) as string[][];
    expect(lines).toContainEqual(["markers", expect.stringMatching(/^agent_test:/)]);
    const packFile = "tests/owasp/owasp-pack.redteam.ts";
    for (const glob of configDefaults.include) expect(path.matchesGlob(packFile, glob)).toBe(false);
    expect(packVitestConfig.test?.include).toEqual(["owasp-pack.redteam.ts"]);
    const rendered = renderSkill(owaspSkill());
    const page = fs.readFileSync(
      path.join(repoRoot, "docs", "agent-testing", "owasp-red-team.mdx"),
      "utf8",
    );
    for (const text of [rendered, page]) {
      expect(text).toContain('-m "not agent_test"');
      expect(text).toContain("-m agent_test");
      expect(text).toContain("owasp.vitest.config.ts");
    }
  });
});

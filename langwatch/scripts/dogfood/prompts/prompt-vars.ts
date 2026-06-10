/**
 * Replays rchaves's bug screenshots through the post-PR code path so
 * the panel-layer output can be inspected without a browser session.
 *
 * Input: the exact span shape from images 118/120/122/124/126 —
 *   - PromptApiService.get sibling with combined "handle:version" id +
 *     variables.value.prompt_id = "<configId>"
 *   - Prompt.compile sibling with raw configId + handle + version
 *     attrs + variables.value.{example, input, messages:[…]}
 *   - LLM span (target) sharing the same parent + same ms startTime
 *
 * Expected post-fix output (printed below):
 *   - identity (handle, versionNumber) comes from compile (latest tie)
 *   - variables include example, input (user-facing only) — internal
 *     dispatch keys like `prompt_id` are stripped by the merger's
 *     INTERNAL_PROMPT_VARIABLE_KEYS filter (defense in depth: the
 *     Go-side filter also strips them at emit time on fresh traces)
 *   - if `messages` ever leaks through, parseVariablesBlob JSON-encodes
 *     it instead of rendering "[object Object]"
 *
 * Run: npx tsx scripts/dogfood/prompts/prompt-vars.ts
 */
import { findPromptReferenceInAncestors } from "../../../src/server/traces/findPromptReferenceInAncestors";

const PARENT = "parent-span";
const TARGET = "llm-span";

const spans = [
  {
    spanId: PARENT,
    parentSpanId: null,
    startTime: 100,
    attributes: {},
  },
  {
    spanId: "get-span",
    parentSpanId: PARENT,
    startTime: 200,
    attributes: {
      "langwatch.prompt.id": "testtest2:1",
      "langwatch.prompt.variables": JSON.stringify({
        type: "json",
        value: { prompt_id: "prompt_ekZriphlRjDGWW-u1Vglw" },
      }),
    },
  },
  {
    spanId: "compile-span",
    parentSpanId: PARENT,
    startTime: 200,
    attributes: {
      "langwatch.prompt.id": "prompt_ekZriphlRjDGWW-u1Vglw",
      "langwatch.prompt.handle": "testtest2",
      "langwatch.prompt.version.id": "prompt_version__15tZH2WRCGjtqJ5bQoaN",
      "langwatch.prompt.version.number": 1,
      "langwatch.prompt.variables": JSON.stringify({
        type: "json",
        value: {
          example: "foobar",
          input: "how big is mars?",
          messages: [{ role: "user", content: "{{input}}" }],
        },
      }),
    },
  },
  {
    spanId: TARGET,
    parentSpanId: PARENT,
    startTime: 200,
    attributes: {},
  },
];

const result = findPromptReferenceInAncestors({ targetSpanId: TARGET, spans });

console.log("=".repeat(72));
console.log("INPUT (replay of trace from rchaves's bug screenshots)");
console.log("=".repeat(72));
console.log(
  "  spans:",
  spans.map((s) => ({
    spanId: s.spanId,
    parent: s.parentSpanId,
    startTime: s.startTime,
    attrKeys: Object.keys(s.attributes),
  })),
);
console.log();
console.log("=".repeat(72));
console.log("OUTPUT — what the playground 'Open in Prompts' panel sees");
console.log("=".repeat(72));
console.log(JSON.stringify(result, null, 2));
console.log();
console.log("=".repeat(72));
console.log("VERIFICATION");
console.log("=".repeat(72));
const vars = result?.promptVariables ?? {};
const checks = [
  {
    name: "Bug #1: messages stripped by INTERNAL_PROMPT_VARIABLE_KEYS filter (defense in depth — if it ever leaked through, parseVariablesBlob would JSON-encode it instead of String(val)='[object Object]')",
    pass: vars.messages === undefined,
    got: vars.messages,
  },
  {
    name: "Bug #2/#3: prompt_id stripped by INTERNAL_PROMPT_VARIABLE_KEYS filter",
    pass: vars.prompt_id === undefined,
    got: vars.prompt_id,
  },
  {
    name: "Bug #4: 'example' variable from compile span pre-fills",
    pass: vars.example === "foobar",
    got: vars.example,
  },
  {
    name: "Bug #4: 'input' variable from compile span pre-fills",
    pass: vars.input === "how big is mars?",
    got: vars.input,
  },
  {
    name: "Identity: handle resolves to 'testtest2' (canonical slug from langwatch.prompt.handle attr, NOT the raw configId from prompt.id)",
    pass: result?.promptHandle === "testtest2",
    got: result?.promptHandle,
  },
  {
    name: "Identity: versionNumber = 1 (from compile span — latest of tied startTimes)",
    pass: result?.promptVersionNumber === 1,
    got: result?.promptVersionNumber,
  },
  {
    name: "Identity: versionId preserved",
    pass:
      result?.promptVersionId === "prompt_version__15tZH2WRCGjtqJ5bQoaN",
    got: result?.promptVersionId,
  },
];
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.pass) console.log(`        got: ${JSON.stringify(c.got)}`);
}
const allPass = checks.every((c) => c.pass);
console.log();
console.log(allPass ? "ALL CHECKS PASS" : "FAILURES PRESENT");
process.exit(allPass ? 0 : 1);

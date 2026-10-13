/**
 * Seeds the "Rich cells" dataset and experiment (two runs) on this worktree's haven stack, so
 * table migrations compare before and after: `node dev/scripts/seed-rich-cells.ts [--stack x]`.
 * Credentials come from `haven env --reveal` inside this process and are never printed.
 */
import { execFileSync } from "node:child_process";

const stackArgIndex = process.argv.indexOf("--stack");
const stackArgs = stackArgIndex > 0 ? ["--stack", process.argv[stackArgIndex + 1]!] : [];
const envText = execFileSync("haven", ["env", "--reveal", ...stackArgs], { encoding: "utf8" });
const pick = (name: string) =>
  new RegExp(`^export ${name}=(.*)$`, "m").exec(envText)?.[1]?.replace(/^['"]|['"]$/g, "");
const endpoint = pick("LANGWATCH_ENDPOINT");
const apiKey = pick("HAVEN_SEED_LANGWATCH_API_KEY");
if (!endpoint || !apiKey) throw new Error("haven env gave no endpoint or key");
if (!new URL(endpoint).hostname.endsWith("localhost")) throw new Error("local stacks only");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-auth-token": apiKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

const ROWS = 32;
const IMAGES = [
  "https://picsum.photos/seed/lw1/640/360",
  "https://picsum.photos/seed/lw2/320/900",
  "https://via.placeholder.com/1200x200.png",
  "https://example.invalid/missing-image.png",
];

const markdown = (i: number) => `# Quarterly report ${i}

## Highlights

- **Revenue** grew *${i + 3}%* quarter on quarter
  - EMEA: \`€${i * 12}k\`
  - APAC: \`$${i * 9}k\`
    - nested again with a [link](https://langwatch.ai/docs?row=${i}&q=a%20b)
1. First ordered item
2. Second ordered item with ~~strikethrough~~

| Region | Q1 | Q2 | Notes |
| ------ | -: | -: | ----- |
| EMEA | ${i} | ${i * 2} | a fairly long note that forces the column to wrap onto several lines |
| APAC | ${i + 1} | ${i * 3} | short |

> A block quote with \`inline code\` and a very long unbroken token: ${"x".repeat(80)}

\`\`\`ts
export function row${i}(input: { id: number }): string {
  const nested = { a: [1, 2, { b: "deep" }], c: null };
  return JSON.stringify({ ...nested, id: input.id });
}
\`\`\`

\`\`\`python
def row_${i}():
    return {"ok": True, "items": [n ** 2 for n in range(${i + 5})]}
\`\`\`
${"\nExtra paragraph to make the cell tall. ".repeat(i % 5)}`;

const toolArgs = (i: number) =>
  JSON.stringify({
    query: `order ${i}`,
    filters: { status: ["open", "late"], range: { from: "2026-01-01", to: "2026-03-31" } },
    limit: 25,
  });

const messages = (i: number) => [
  { role: "system", content: "You are a careful support agent. Use tools when needed." },
  { role: "user", content: `Where is order #${1000 + i}? Please check the warehouse as well.` },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: `call_${i}_a`,
        type: "function",
        function: { name: "lookup_order", arguments: toolArgs(i) },
      },
      {
        id: `call_${i}_b`,
        type: "function",
        function: {
          name: "check_warehouse",
          arguments: JSON.stringify({
            sku: [`SKU-${i}`, `SKU-${i + 1}`],
            nested: { depth: { deeper: { deepest: [1, 2, 3] } } },
          }),
        },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: `call_${i}_a`,
    content: JSON.stringify({
      order: {
        id: 1000 + i,
        items: [{ sku: `SKU-${i}`, qty: 2 }],
        history: [
          { at: "2026-02-01T10:00:00Z", event: "packed" },
          {
            at: "2026-02-02T08:30:00Z",
            event: "shipped",
            carrier: { name: "ACME", tracking: `TRK${i}${"9".repeat(12)}` },
          },
        ],
      },
    }),
  },
  {
    role: "tool",
    tool_call_id: `call_${i}_b`,
    content: JSON.stringify({
      stock: { [`SKU-${i}`]: 14, [`SKU-${i + 1}`]: 0 },
      notes: "Second SKU is back-ordered",
    }),
  },
  {
    role: "assistant",
    content: `Your order **#${1000 + i}** shipped on 2 Feb.\n\n- Carrier: ACME\n- Tracking: \`TRK${i}\`\n\nOne item is back-ordered.`,
  },
];

const bigJson = (i: number) => ({
  id: i,
  meta: {
    created: "2026-03-01T12:00:00Z",
    flags: { beta: i % 2 === 0, tiers: ["free", "pro", { custom: { seats: i * 10 } }] },
  },
  items: Array.from({ length: 12 }, (_, k) => ({
    k,
    label: `item-${i}-${k}`,
    price: k * 1.25,
    tags: ["a", "b", "c"].slice(0, (k % 3) + 1),
    dims: { w: k, h: k * 2, d: null },
  })),
  unicode: "naïve café — 日本語 — Ελληνικά",
});

const multiline = (i: number) =>
  `Row ${i} 🎉🚀✨ multi-line\nSecond line with emoji 👩🏽‍💻🏳️‍🌈 and tab\tseparated\nمرحبا بالعالم — هذا نص من اليمين إلى اليسار ${i}\nשלום עולם, שורה ${i}\n   leading spaces and trailing   \n\n(blank line above)`;

const rows = Array.from({ length: ROWS }, (_, i) => ({
  id: `row-${String(i).padStart(2, "0")}`,
  markdown: markdown(i),
  messages: messages(i),
  payload: bigJson(i),
  long_line: `LONG-${i}-` + "abcdefghij0123456789_".repeat(40 + i),
  multiline: multiline(i),
  image: IMAGES[i % IMAGES.length],
  empty: "",
  nullable: i % 3 === 0 ? null : `value ${i}`,
  score: i % 7 === 0 ? 0 : i * 1.37 - 4,
  flag: i % 2 === 0,
  tags: i % 4 === 0 ? [] : ["alpha", `beta-${i}`, "gamma delta epsilon"],
}));

const columnTypes = [
  { name: "id", type: "string" },
  { name: "markdown", type: "string" },
  { name: "messages", type: "chat_messages" },
  { name: "payload", type: "json" },
  { name: "long_line", type: "string" },
  { name: "multiline", type: "string" },
  { name: "image", type: "image" },
  { name: "empty", type: "string" },
  { name: "nullable", type: "string" },
  { name: "score", type: "number" },
  { name: "flag", type: "boolean" },
  { name: "tags", type: "list" },
];

const datasetName = "Rich cells";
const existing = await call("GET", "/api/dataset?limit=100");
let dataset = existing.data.find((d: { name: string }) => d.name === datasetName);
if (!dataset) {
  dataset = await call("POST", "/api/dataset", { name: datasetName, columnTypes });
  for (let start = 0; start < rows.length; start += 16) {
    await call("POST", `/api/dataset/${dataset.slug}/records`, {
      entries: rows.slice(start, start + 16),
    });
  }
  console.log(`created dataset ${dataset.id} (${rows.length} rows)`);
} else {
  console.log(`dataset exists ${dataset.id}; delete it to reseed`);
}
console.log(`dataset url: ${dataset.platformUrl}`);

const slug = "rich-cells-experiment";
const targets = [
  {
    id: "agent-a",
    name: "Agent A (tool user)",
    type: "custom",
    model: "markov-tools",
    metadata: { temperature: 0.2, variant: "a" },
  },
  {
    id: "agent-b",
    name: "Agent B (verbose)",
    type: "custom",
    model: "markov-small",
    metadata: { temperature: 0.9, variant: "b" },
  },
];

const output = (target: string, i: number) => ({
  output:
    target === "agent-a"
      ? `## Answer for row ${i}\n\n1. Looked up the order\n2. Checked **stock**\n\n\`\`\`json\n${JSON.stringify(bigJson(i).items.slice(0, 3), null, 2)}\n\`\`\``
      : `${"Verbose answer. ".repeat(30 + i)}\n\nمرحبا 🎉 ${i}`,
  trace: messages(i).slice(2, 5),
  tool_calls: [{ name: "lookup_order", arguments: JSON.parse(toolArgs(i)) }],
  empty: "",
});

function formatStatus(i: number): "processed" | "skipped" | "error" {
  if (i % 9 === 8) return "skipped";
  if (i % 14 === 13) return "error";
  return "processed";
}

function resultsFor({
  row,
  i,
  target,
  shift,
}: {
  row: (typeof rows)[number];
  i: number;
  target: (typeof targets)[number];
  shift: number;
}) {
  const failed = (i + shift + (target.id === "agent-b" ? 1 : 0)) % 5 === 0;
  const entry = {
    index: i,
    target_id: target.id,
    entry: row,
    predicted: i % 11 === 10 && target.id === "agent-b" ? null : output(target.id, i + shift),
    cost: 0.0001 * (i + 1),
    duration: 400 + i * 37,
    error:
      i % 13 === 12 && target.id === "agent-a"
        ? `Error: tool call failed\n    at lookup (agent.ts:${i}:7)\n    at run (agent.ts:42:3)`
        : null,
    trace_id: null,
  };
  const evaluations = [
    {
      evaluator: "answer_quality",
      name: "Answer quality",
      target_id: target.id,
      status: "processed",
      index: i,
      score: ((i * 17 + shift * 3 + (target.id === "agent-b" ? 5 : 0)) % 100) / 100,
      passed: !failed,
      label: failed ? "needs work" : "good",
      details: `Long reasoning for row ${i}: ${"The answer cites the tool result, ".repeat(12)}\n\n- point one\n- point two\n\n**Verdict**: ${failed ? "fail" : "pass"}`,
      duration: 120,
      cost: 0.00002,
    },
    {
      evaluator: "format_check",
      name: "Format check",
      target_id: target.id,
      status: formatStatus(i),
      index: i,
      passed: i % 4 !== 0,
      details:
        i % 14 === 13 ? "Evaluator crashed: timeout after 30s" : "Markdown structure checked",
    },
  ];
  return { entry, evaluations };
}

const runExperiment = async (runId: string, shift: number) => {
  const now = Date.now();
  const results = rows.flatMap((row, i) =>
    targets.map((target) => resultsFor({ row, i, target, shift })),
  );
  const dataset_ = results.map((result) => result.entry);
  const evaluations = results.flatMap((result) => result.evaluations);
  await call("POST", "/api/evaluations/batch/log_results", {
    experiment_slug: slug,
    name: "Rich cells experiment",
    run_id: runId,
    targets,
    dataset: dataset_,
    evaluations,
    progress: ROWS * targets.length,
    total: ROWS * targets.length,
    timestamps: { created_at: now - shift * 60000, finished_at: now - shift * 60000 + 90000 },
  });
  console.log(`logged run ${runId}`);
};

await runExperiment("rich-cells-run-1", 0);
await runExperiment("rich-cells-run-2", 2);
console.log(`experiment slug: ${slug} (open /<project>/experiments/${slug})`);

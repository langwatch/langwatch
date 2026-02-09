/**
 * Python SDK Example Runner
 *
 * Runs a subset of Python SDK examples against each backend,
 * captures trace IDs from stdout, and returns results for comparison.
 */

import { exec } from "node:child_process";
import { resolve } from "node:path";
import type { PythonRunResult } from "./types.js";

const PYTHON_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Representative subset of examples for parity checking.
// Covers: basic LLM, RAG, streaming, function calls, manual spans,
// OpenTelemetry/OpenInference integrations, and framework-specific patterns.
const PARITY_EXAMPLES = [
  "openai_bot",
  "openai_bot_rag",
  "openai_bot_function_call",
  "generic_bot",
  "generic_bot_streaming",
  "generic_bot_span_context_manager",
  "generic_bot_exception",
  "opentelemetry/openinference_openai_bot",
  "opentelemetry/openinference_langchain_bot",
];

/**
 * Extract trace IDs from JSON blocks printed by test_examples.py.
 *
 * In parity mode, test_examples.py prints trace IDs directly instead of share URLs:
 *   { "openai_bot.py": "abc123def456...", ... }
 *
 * In non-parity mode, it prints share URLs:
 *   { "openai_bot.py": "http://localhost:5560/share/trace/abc123", ... }
 *
 * This parser handles both formats.
 */
function parseTraceIds(stdout: string): Map<string, string> {
  const traceMap = new Map<string, string>();

  // Find all JSON blocks in stdout. The test prints accumulated results after each test,
  // so the LAST JSON block has the most complete set of results.
  const jsonBlocks: string[] = [];
  const lines = stdout.split("\n");
  let inBlock = false;
  let blockLines: string[] = [];
  let braceDepth = 0;

  for (const line of lines) {
    if (!inBlock && line.trim().startsWith("{")) {
      inBlock = true;
      blockLines = [];
      braceDepth = 0;
    }
    if (inBlock) {
      blockLines.push(line);
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth === 0) {
        jsonBlocks.push(blockLines.join("\n"));
        inBlock = false;
      }
    }
  }

  if (jsonBlocks.length === 0) return traceMap;

  // Use the last (most complete) JSON block
  const lastJson = jsonBlocks[jsonBlocks.length - 1]!;

  try {
    const parsed = JSON.parse(lastJson) as Record<string, string>;

    for (const [exampleName, value] of Object.entries(parsed)) {
      // Try extracting trace ID from URL first (non-parity mode)
      const urlMatch = value.match(/trace\/([a-f0-9]+)/);
      if (urlMatch?.[1]) {
        traceMap.set(exampleName, urlMatch[1]);
        continue;
      }

      // In parity mode, the value IS the trace ID (hex string)
      if (/^[a-f0-9]{16,64}$/.test(value)) {
        traceMap.set(exampleName, value);
        continue;
      }

      // Fallback: treat as-is if it looks like any kind of ID
      if (value && value !== "unknown" && value.length >= 8) {
        traceMap.set(exampleName, value);
      }
    }
  } catch {
    // Fallback: line-by-line parsing
    for (const line of lines) {
      const match = line.match(/"([^"]+\.py)"\s*:\s*"([a-f0-9]{16,64})"/);
      if (match?.[1] && match[2]) {
        traceMap.set(match[1], match[2]);
      }
    }
  }

  return traceMap;
}

/**
 * Run Python SDK examples against a specific backend
 */
function runPythonTestExamples({
  pythonSdkDir,
  apiKey,
  endpoint,
  runPrefix,
}: {
  pythonSdkDir: string;
  apiKey: string;
  endpoint: string;
  runPrefix?: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = resolve(pythonSdkDir);

  // Run only a representative subset of examples for faster, reliable parity checks.
  // Use ".py]" suffix in -k filter for exact matching (test IDs are like
  // "test_example[examples/openai_bot.py]", so "openai_bot.py]" avoids matching
  // "openai_bot_rag.py]" etc.)
  const kFilter = PARITY_EXAMPLES.map((name) => `${name}.py]`).join(" or ");
  const cmd = `uv run pytest tests/test_examples.py -p no:warnings -s -k "${kFilter}"`;

  return new Promise((resolvePromise) => {
    exec(
      cmd,
      {
        cwd,
        timeout: PYTHON_TIMEOUT_MS,
        env: {
          ...process.env,
          LANGWATCH_API_KEY: apiKey,
          LANGWATCH_ENDPOINT: endpoint,
          PYTHONPATH: `${process.env["PYTHONPATH"] ?? ""}:${cwd}`,
          ...(runPrefix ? { PARITY_RUN_PREFIX: runPrefix } : {}),
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      },
      (error, stdout, stderr) => {
        resolvePromise({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error?.code ?? (error ? 1 : 0),
        });
      },
    );
  });
}

/**
 * Run Python SDK examples against both backends and collect results
 */
export async function runPythonExamples({
  pythonSdkDir,
  esApiKey,
  chApiKey,
  baseUrl,
  runPrefix,
}: {
  pythonSdkDir: string;
  esApiKey: string;
  chApiKey: string;
  baseUrl: string;
  runPrefix?: string;
}): Promise<{
  esResults: PythonRunResult[];
  chResults: PythonRunResult[];
}> {
  console.log("  Running Python SDK examples against ES backend...");
  console.log(`  (subset: ${PARITY_EXAMPLES.join(", ")})`);
  const esRun = await runPythonTestExamples({
    pythonSdkDir,
    apiKey: esApiKey,
    endpoint: baseUrl,
    runPrefix,
  });

  if (esRun.exitCode !== 0) {
    console.log(`  Warning: ES run exited with code ${esRun.exitCode}`);
    if (esRun.stderr) {
      console.log(`  stderr (last 500 chars): ${esRun.stderr.slice(-500)}`);
    }
  }

  const esTraceIds = parseTraceIds(esRun.stdout);
  console.log(`  ES: Found ${esTraceIds.size} trace IDs`);
  for (const [name, id] of esTraceIds) {
    console.log(`    ${name}: ${id}`);
  }

  console.log("  Running Python SDK examples against CH backend...");
  const chRun = await runPythonTestExamples({
    pythonSdkDir,
    apiKey: chApiKey,
    endpoint: baseUrl,
    runPrefix,
  });

  if (chRun.exitCode !== 0) {
    console.log(`  Warning: CH run exited with code ${chRun.exitCode}`);
    if (chRun.stderr) {
      console.log(`  stderr (last 500 chars): ${chRun.stderr.slice(-500)}`);
    }
  }

  const chTraceIds = parseTraceIds(chRun.stdout);
  console.log(`  CH: Found ${chTraceIds.size} trace IDs`);
  for (const [name, id] of chTraceIds) {
    console.log(`    ${name}: ${id}`);
  }

  const esResults: PythonRunResult[] = [];
  for (const [name, traceId] of esTraceIds) {
    esResults.push({ exampleName: name, traceId, success: true });
  }

  const chResults: PythonRunResult[] = [];
  for (const [name, traceId] of chTraceIds) {
    chResults.push({ exampleName: name, traceId, success: true });
  }

  return { esResults, chResults };
}

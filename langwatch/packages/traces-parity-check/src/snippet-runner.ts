/**
 * Onboarding Snippet Runner
 *
 * Runs onboarding snippets from the codegen directory against both
 * ES and CH backends. Each snippet gets its own ephemeral folder with
 * standard tooling (uv init, pnpm init, go mod init). Run each snippet
 * twice (once per backend), record time windows for trace discovery.
 *
 * Install commands match registry.tsx (the onboarding UI source of truth).
 * Runtime-only extras (tsx, otel, langchain) are appended where needed.
 */

import { exec } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SnippetRunResult, SnippetSingleRunResult } from "./types.js";

const SNIPPET_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes per snippet (includes dep install)

// Snippets dir relative to the langwatch app root
const SNIPPETS_BASE =
  "src/features/onboarding/regions/observability/codegen/snippets";

interface SnippetDef {
  name: string;
  language: "python" | "typescript" | "go";
  snippetFile: string; // relative path under snippets dir
  filename: string; // target filename in ephemeral dir (app.py / app.ts / main.go)
  initCmd: string;
  installCmd: string;
  runCmd: string;
  requiredEnvVars?: string[];
}

// Install commands sourced from registry.tsx — keep in sync.
// Runtime-only extras noted in comments.
const SNIPPET_DEFS: SnippetDef[] = [
  // Python snippets
  {
    name: "python-openai",
    language: "python",
    snippetFile: "python/openai.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch openai",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-langchain",
    language: "python",
    snippetFile: "python/langchain.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch langchain langchain-openai",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-langgraph",
    language: "python",
    snippetFile: "python/langgraph.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    // registry: langwatch langgraph langchain-openai  +langchain (snippet imports langchain.tools)
    installCmd: "uv add langwatch langgraph langchain-openai langchain",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-litellm",
    language: "python",
    snippetFile: "python/litellm.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch litellm",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-dspy",
    language: "python",
    snippetFile: "python/dspy.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch dspy",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-haystack",
    language: "python",
    snippetFile: "python/haystack.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch openinference-instrumentation-haystack haystack-ai",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-strands",
    language: "python",
    snippetFile: "python/strandsagents.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    // registry: langwatch strands-agents strands-agents-tools  +litellm (runtime model routing)
    installCmd: "uv add langwatch strands-agents strands-agents-tools litellm",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-openaiagents",
    language: "python",
    snippetFile: "python/openaiagents.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch openai-agents openinference-instrumentation-openai-agents",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-pydanticai",
    language: "python",
    snippetFile: "python/pydanticai.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch pydantic-ai",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "python-agno",
    language: "python",
    snippetFile: "python/agno.snippet.py",
    filename: "app.py",
    initCmd: "uv init --quiet",
    installCmd: "uv add langwatch agno openai openinference-instrumentation-agno",
    runCmd: "uv run python app.py",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },

  // TypeScript snippets (npm to avoid pnpm store lock contention; +tsx for execution)
  {
    name: "ts-vercelai",
    language: "typescript",
    snippetFile: "typescript/vercelai.snippet.sts",
    filename: "app.ts",
    initCmd: "npm init -y",
    installCmd: "npm install langwatch ai @ai-sdk/openai tsx",
    runCmd: "npx tsx app.ts",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "ts-langchain",
    language: "typescript",
    snippetFile: "typescript/langchain.snippet.sts",
    filename: "app.ts",
    initCmd: "npm init -y",
    installCmd: "npm install langwatch @langchain/openai @langchain/core tsx",
    runCmd: "npx tsx app.ts",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "ts-langgraph",
    language: "typescript",
    snippetFile: "typescript/langgraph.snippet.sts",
    filename: "app.ts",
    initCmd: "npm init -y",
    installCmd: "npm install langwatch @langchain/openai @langchain/core @langchain/langgraph zod tsx",
    runCmd: "npx tsx app.ts",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "ts-openai",
    language: "typescript",
    snippetFile: "typescript/openai.snippet.sts",
    filename: "app.ts",
    initCmd: "npm init -y",
    installCmd: "npm install langwatch openai tsx",
    runCmd: "npx tsx app.ts",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },

  // Go snippets (+otel deps used directly in snippets but not in registry)
  {
    name: "go-openai",
    language: "go",
    snippetFile: "go/openai.snippet.go",
    filename: "main.go",
    initCmd: "go mod init parity/check",
    installCmd: "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk/trace",
    runCmd: "go run main.go",
    requiredEnvVars: ["OPENAI_API_KEY"],
  },
  {
    name: "go-anthropic",
    language: "go",
    snippetFile: "go/anthropic.snippet.go",
    filename: "main.go",
    initCmd: "go mod init parity/check",
    installCmd: "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk/trace",
    runCmd: "go run main.go",
    requiredEnvVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
  },
  {
    name: "go-gemini",
    language: "go",
    snippetFile: "go/gemini.snippet.go",
    filename: "main.go",
    initCmd: "go mod init parity/check",
    installCmd: "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk/trace",
    runCmd: "go run main.go",
    requiredEnvVars: ["GEMINI_API_KEY", "GEMINI_BASE_URL"],
  },
  {
    name: "go-groq",
    language: "go",
    snippetFile: "go/groq.snippet.go",
    filename: "main.go",
    initCmd: "go mod init parity/check",
    installCmd: "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk/trace",
    runCmd: "go run main.go",
    requiredEnvVars: ["GROQ_API_KEY"],
  },
  {
    name: "go-grok",
    language: "go",
    snippetFile: "go/grok.snippet.go",
    filename: "main.go",
    initCmd: "go mod init parity/check",
    installCmd: "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk/trace",
    runCmd: "go run main.go",
    requiredEnvVars: ["XAI_API_KEY", "GROK_BASE_URL"],
  },
  {
    name: "go-mistral",
    language: "go",
    snippetFile: "go/mistral.snippet.go",
    filename: "main.go",
    initCmd: "go mod init parity/check",
    installCmd: "go get github.com/langwatch/langwatch/sdk-go github.com/openai/openai-go go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk/trace",
    runCmd: "go run main.go",
    requiredEnvVars: ["MISTRAL_API_KEY", "MISTRAL_BASE_URL"],
  },
];

/**
 * Replace placeholders in snippet source code.
 * Uses a unique serviceName so the trace can be identified by resource attributes.
 */
function processSnippetSource({
  source,
  baseUrl,
  serviceName,
}: {
  source: string;
  baseUrl: string;
  serviceName: string;
}): string {
  let result = source;
  // Replace <project_name> with the unique service name (used by TS/Go snippets)
  result = result.replace(/<project_name>/g, serviceName);
  // Strip "# +" suffix comments (Python highlight markers)
  result = result.replace(/\s*# \+$/gm, "");
  // Strip "// +" suffix comments (TS/Go highlight markers)
  result = result.replace(/\s*\/\/ \+$/gm, "");
  // Replace hardcoded app URL with the actual base URL
  result = result.replace(/https:\/\/app\.langwatch\.ai/g, baseUrl);
  return result;
}

/**
 * Run a shell command in a directory, returning stdout/stderr/exitCode.
 */
function execInDir({
  cmd,
  cwd,
  env,
  timeoutMs,
}: {
  cmd: string;
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolvePromise) => {
    exec(
      cmd,
      {
        cwd,
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        maxBuffer: 5 * 1024 * 1024,
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
 * Run a single snippet against one backend in an ephemeral directory.
 * Sets OTEL resource attributes so the resulting trace can be identified.
 */
async function runSnippetOnce({
  def,
  snippetSource,
  apiKey,
  baseUrl,
  backend,
}: {
  def: SnippetDef;
  snippetSource: string;
  apiKey: string;
  baseUrl: string;
  backend: "es" | "ch";
}): Promise<SnippetSingleRunResult> {
  // Unique service name per snippet — used for trace identification
  const serviceName = `parity-${def.name}`;
  const startTime = Date.now();
  const tempDir = await mkdtemp(
    resolve(tmpdir(), `parity-${def.language}-${def.name}-`),
  );

  const failResult = (error: string, stdout?: string, stderr?: string): SnippetSingleRunResult => {
    const endTime = Date.now();
    return {
      success: false,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      serviceName,
      backend,
      error,
      stdout: stdout?.slice(-500),
      stderr: stderr?.slice(-500),
    };
  };

  try {
    // 1. Init project
    const initResult = await execInDir({
      cmd: def.initCmd,
      cwd: tempDir,
      env: {},
      timeoutMs: SNIPPET_TIMEOUT_MS,
    });
    if (initResult.exitCode !== 0) {
      return failResult(
        `init failed (exit ${initResult.exitCode}): ${initResult.stderr.slice(-500)}`,
        initResult.stdout, initResult.stderr,
      );
    }

    // 1b. For TypeScript: enable ESM (top-level await needs "type": "module")
    if (def.language === "typescript") {
      const pkgJsonPath = resolve(tempDir, "package.json");
      const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
      pkgJson.type = "module";
      await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
    }

    // 2. Install deps
    const installResult = await execInDir({
      cmd: def.installCmd,
      cwd: tempDir,
      env: {},
      timeoutMs: SNIPPET_TIMEOUT_MS,
    });
    if (installResult.exitCode !== 0) {
      return failResult(
        `install failed (exit ${installResult.exitCode}): ${installResult.stderr.slice(-500)}`,
        installResult.stdout, installResult.stderr,
      );
    }

    // 3. Write snippet code (with unique service name replacing <project_name>)
    const processedSource = processSnippetSource({
      source: snippetSource,
      baseUrl,
      serviceName,
    });
    await writeFile(resolve(tempDir, def.filename), processedSource, "utf-8");

    // 4. Run snippet with OTEL resource attributes for trace identification.
    //    OTEL_SERVICE_NAME sets the service.name resource attribute (used by all SDKs).
    //    OTEL_RESOURCE_ATTRIBUTES adds custom attributes for backend identification.
    const runResult = await execInDir({
      cmd: def.runCmd,
      cwd: tempDir,
      env: {
        LANGWATCH_API_KEY: apiKey,
        LANGWATCH_ENDPOINT: baseUrl,
        OTEL_SERVICE_NAME: serviceName,
        OTEL_RESOURCE_ATTRIBUTES: `parity.snippet=${def.name},parity.backend=${backend}`,
      },
      timeoutMs: SNIPPET_TIMEOUT_MS,
    });

    const endTime = Date.now();

    if (runResult.exitCode !== 0) {
      return failResult(
        `run failed (exit ${runResult.exitCode}): ${runResult.stderr.slice(-500)}`,
        runResult.stdout, runResult.stderr,
      );
    }

    return { success: true, startTime, endTime, durationMs: endTime - startTime, serviceName, backend };
  } finally {
    // Cleanup temp dir
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

const CONCURRENCY = 4; // Max parallel snippet runs

/**
 * Run tasks with a concurrency limit.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]!();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

/**
 * Run all onboarding snippets against both ES and CH backends.
 * Snippets run in parallel (up to CONCURRENCY), ES+CH for each snippet also in parallel.
 */
export interface SnippetRunnerOutput {
  results: SnippetRunResult[];
  envSkipped: { name: string; missingEnvVars: string[] }[];
  totalDefined: number;
}

export async function runOnboardingSnippets({
  baseUrl,
  esApiKey,
  chApiKey,
}: {
  baseUrl: string;
  esApiKey: string;
  chApiKey: string;
}): Promise<SnippetRunnerOutput> {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const langwatchAppDir = resolve(thisDir, "..", "..", "..");
  const snippetsDir = resolve(langwatchAppDir, SNIPPETS_BASE);

  // Filter snippets by available env vars, track skips
  const envSkipped: { name: string; missingEnvVars: string[] }[] = [];
  const runnableSnippets = SNIPPET_DEFS.filter((def) => {
    const missing = (def.requiredEnvVars ?? []).filter(
      (v) => !process.env[v],
    );
    if (missing.length > 0) {
      console.log(
        `    ${def.name}: skip (missing ${missing.join(", ")})`,
      );
      envSkipped.push({ name: def.name, missingEnvVars: missing });
      return false;
    }
    return true;
  });

  console.log(
    `  Running ${runnableSnippets.length}/${SNIPPET_DEFS.length} onboarding snippets (concurrency: ${CONCURRENCY})...`,
  );

  // Build tasks: each snippet runs ES + CH in parallel
  const tasks = runnableSnippets.map((def) => async (): Promise<SnippetRunResult | null> => {
    const snippetPath = resolve(snippetsDir, def.snippetFile);
    let snippetSource: string;
    try {
      snippetSource = await readFile(snippetPath, "utf-8");
    } catch {
      console.log(`    ${def.name}: skip (snippet file not found)`);
      return null;
    }

    // Run ES and CH in parallel for this snippet
    const [esRun, chRun] = await Promise.all([
      runSnippetOnce({ def, snippetSource, apiKey: esApiKey, baseUrl, backend: "es" }),
      runSnippetOnce({ def, snippetSource, apiKey: chApiKey, baseUrl, backend: "ch" }),
    ]);

    const esStatus = esRun.success ? "ok" : "fail";
    const chStatus = chRun.success ? "ok" : "fail";
    console.log(`    ${def.name}: ES ${esStatus}, CH ${chStatus}`);

    return { snippetName: def.name, language: def.language, esRun, chRun };
  });

  const rawResults = await runWithConcurrency(tasks, CONCURRENCY);
  const results = rawResults.filter((r): r is SnippetRunResult => r !== null);

  const esOk = results.filter((r) => r.esRun.success).length;
  const chOk = results.filter((r) => r.chRun.success).length;
  console.log(
    `  Snippets completed: ES ${esOk}/${results.length} ok, CH ${chOk}/${results.length} ok`,
  );

  return { results, envSkipped, totalDefined: SNIPPET_DEFS.length };
}

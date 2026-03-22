/**
 * Maps each scenario test description to the file patterns it depends on.
 *
 * When any file matching a test's patterns changes, that test is selected for execution.
 * Patterns use glob syntax: `**` matches any path depth, `*` matches within a single segment.
 *
 * Each entry includes:
 * 1. The skill directory the test exercises
 * 2. Shared content (`skills/_shared/**`)
 * 3. The fixture codebase it uses
 */
export const TOUCHFILES: Record<string, string[]> = {
  // ─── Tracing (tracing.scenario.test.ts) ─────────────────────────
  "instruments a Python OpenAI bot with LangWatch": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "instruments a TypeScript Vercel AI bot with LangWatch": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-vercel/**",
  ],
  "instruments a Python LangGraph agent with LangWatch": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-langgraph/**",
  ],
  "instruments a TypeScript Mastra agent with LangWatch": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-mastra/**",
  ],
  "instruments a Python Google ADK agent with LangWatch": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-google-adk/**",
  ],
  "instruments code without env API key — discovers from .env file": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "instruments code without MCP — uses llms.txt fallback for docs": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "asks user for API key when not found in environment or .env": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "instruments a Google ADK agent with LangWatch": [
    "skills/tracing/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-google-adk/**",
  ],

  // ─── Evaluations (evaluations.scenario.test.ts) ─────────────────
  "creates an evaluation experiment for a Python OpenAI bot": [
    "skills/evaluations/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "creates an evaluation experiment for a TypeScript Vercel AI bot": [
    "skills/evaluations/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-vercel/**",
  ],
  "creates an evaluation experiment for a Python LangGraph agent": [
    "skills/evaluations/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-langgraph/**",
  ],
  "creates a targeted evaluation for RAG faithfulness": [
    "skills/evaluations/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "creates domain-specific evaluation for a RAG agent": [
    "skills/evaluations/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-rag-agent/**",
  ],
  "creates evaluation for a Google ADK agent using Gemini models — not OpenAI":
    [
      "skills/evaluations/**",
      "skills/_shared/**",
      "skills/_tests/fixtures/python-google-adk/**",
    ],
  "evaluations actually work — evaluators created on platform": [
    "skills/evaluations/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-weather-agent/**",
  ],

  // ─── Scenarios (scenarios.scenario.test.ts) ──────────────────────
  "creates scenario tests for a Python OpenAI bot": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "creates scenario tests for a TypeScript Vercel AI bot": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-vercel/**",
  ],
  "creates scenario tests for a Python LangGraph agent": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-langgraph/**",
  ],
  "creates red team tests for a Python OpenAI bot": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "creates red team tests for a TypeScript Vercel AI bot": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-vercel/**",
  ],
  "creates a targeted scenario for a specific behavior": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "uses platform MCP tools when no codebase is present": [
    "skills/scenarios/**",
    "skills/_shared/**",
  ],
  "creates scenario tests for a TypeScript Mastra agent": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-mastra/**",
  ],
  "creates domain-specific scenarios for a RAG agent": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-rag-agent/**",
  ],
  "suggests domain-specific improvements after delivering initial scenarios": [
    "skills/scenarios/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-rag-agent/**",
  ],
  "creates scenario tests for a Google ADK agent using Gemini models — not OpenAI":
    [
      "skills/scenarios/**",
      "skills/_shared/**",
      "skills/_tests/fixtures/python-google-adk/**",
    ],

  // ─── Prompts (prompts.scenario.test.ts) ──────────────────────────
  "versions prompts in a Python OpenAI bot with LangWatch Prompts CLI": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "versions prompts in a TypeScript Vercel AI bot": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-vercel/**",
  ],
  "versions prompts in a Python LangGraph agent": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-langgraph/**",
  ],
  "versions prompts in a TypeScript Mastra agent": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-mastra/**",
  ],
  "creates a new prompt version for a specific use case": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],

  // ─── Prompts CLI (prompts-cli.scenario.test.ts) ──────────────────
  "agent discovers and uses CLI to version prompts from scratch": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/cli-prompts/**",
  ],
  "agent creates a specific named prompt via CLI": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/cli-prompts/**",
  ],
  "agent uses push --force-local to resolve conflicts non-interactively": [
    "skills/prompts/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/cli-prompts/**",
  ],

  // ─── Analytics (analytics.scenario.test.ts) ──────────────────────
  "queries agent performance from an empty directory": [
    "skills/analytics/**",
    "skills/_shared/**",
  ],

  // ─── Level-up (level-up.scenario.test.ts) ────────────────────────
  "orchestrates all sub-skills for a Python OpenAI bot": [
    "skills/level-up/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
  "orchestrates all sub-skills for a TypeScript Vercel AI bot": [
    "skills/level-up/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-vercel/**",
  ],
  "orchestrates all sub-skills for a Python LangGraph agent": [
    "skills/level-up/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-langgraph/**",
  ],
  "orchestrates all sub-skills for a TypeScript Mastra agent": [
    "skills/level-up/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/typescript-mastra/**",
  ],

  // ─── Recipes (recipes.scenario.test.ts) ──────────────────────────
  "generates a RAG evaluation dataset from the TerraVerde knowledge base": [
    "skills/recipes/generate-rag-dataset/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-rag-agent/**",
  ],
  "creates compliance scenario tests for the health agent": [
    "skills/recipes/test-compliance/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-health-agent/**",
  ],
  "uses MCP to debug instrumentation traces": [
    "skills/recipes/debug-instrumentation/**",
    "skills/_shared/**",
    "skills/_tests/fixtures/python-openai/**",
  ],
};

/**
 * Patterns that, when any matching file changes, trigger ALL tests.
 *
 * These represent shared test infrastructure that every test depends on.
 */
export const GLOBAL_TOUCHFILES: string[] = [
  "skills/_tests/helpers/**",
  "skills/_tests/vitest.config.ts",
  "skills/_tests/package.json",
  "skills/_compiler/**",
];

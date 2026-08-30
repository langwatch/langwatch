/**
 * The code a person copies to connect an agent (ADR-128).
 *
 * The same two snippets the connect-your-agent docs page carries, so the
 * product and the documentation never teach two different things. The name
 * and the environment are filled in when the reader is looking at an agent
 * that already exists, so a teammate can connect their own process to the
 * same identity.
 *
 * The TypeScript snippet declares its run parameters with a zod schema, which
 * is the form the SDK types `params` from and validates the incoming values
 * with.
 *
 * @see docs/agent-simulations/connect-your-agent.mdx
 * @see specs/features/agents/connected-agents-ui.feature
 */

/** The languages the product offers a snippet for. */
export const SNIPPET_LANGUAGES = ["python", "typescript"] as const;

export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number];

/** What each tab is called. */
export const SNIPPET_LANGUAGE_LABELS: Record<SnippetLanguage, string> = {
  python: "Python",
  typescript: "TypeScript",
};

/** The name a snippet uses when it stands for no agent in particular. */
const EXAMPLE_NAME = "support-agent";

/** The function name a TypeScript snippet declares, from the agent name. */
function camelCaseOf(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "myAgent";
  const [first, ...rest] = parts as [string, ...string[]];
  return (
    first.toLowerCase() +
    rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("")
  );
}

/** The function name a Python snippet declares, from the agent name. */
function snakeCaseOf(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts.length === 0 ? "my_agent" : parts.join("_").toLowerCase();
}

/** The Python snippet for an agent, or for the example when none is named. */
export function pythonSnippet({
  name = EXAMPLE_NAME,
  environment,
}: {
  name?: string;
  environment?: string | null;
} = {}): string {
  const options = environment
    ? `name="${name}", environment="${environment}"`
    : `name="${name}"`;
  return [
    "import langwatch",
    "",
    `@langwatch.connect_agent(${options})`,
    `async def ${snakeCaseOf(name)}(messages: list[dict], thread_id: str) -> str:`,
    "    return await run_my_agent(messages)",
  ].join("\n");
}

/** The TypeScript snippet for an agent, or for the example when none is named. */
export function typescriptSnippet({
  name = EXAMPLE_NAME,
  environment,
}: {
  name?: string;
  environment?: string | null;
} = {}): string {
  return [
    'import { z } from "zod";',
    'import { connectAgent } from "langwatch/agent";',
    "",
    `export const ${camelCaseOf(name)} = connectAgent(`,
    "  {",
    `    name: "${name}",`,
    environment
      ? `    environment: "${environment}",`
      : '    environment: process.env.APP_ENV ?? "development",',
    "    parameters: z.object({",
    '      model: z.enum(["gpt-5", "gpt-5-mini"]).default("gpt-5-mini"),',
    "    }),",
    "  },",
    "  async ({ messages, params }) => {",
    "    return await runMyAgent(messages, { model: params.model });",
    "  },",
    ");",
  ].join("\n");
}

/** Both snippets of an agent, keyed by language. */
export function connectSnippets(
  options: { name?: string; environment?: string | null } = {},
): Record<SnippetLanguage, string> {
  return {
    python: pythonSnippet(options),
    typescript: typescriptSnippet(options),
  };
}

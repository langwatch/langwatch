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

/**
 * A string as source code of either language.
 *
 * An agent name is any text of up to 64 characters, so it can hold a quote, a
 * backslash or a line break. Written raw it would end the literal early, and
 * what the reader copies would no longer be the code this page shows. Both
 * languages read the JSON escapes, so one encoder serves both.
 */
function quoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * Words either language refuses as the name of a declaration.
 *
 * The union of the Python keywords and the JavaScript and TypeScript reserved
 * words, so one check serves both snippets. The list holds the words only
 * strict mode refuses as well, because a TypeScript module is always strict.
 * A word that one of the two languages does accept still takes the fallback,
 * which keeps the two snippets of an agent named after the same thing.
 */
const RESERVED_NAMES = new Set([
  "and",
  "arguments",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "def",
  "default",
  "del",
  "delete",
  "do",
  "elif",
  "else",
  "enum",
  "eval",
  "except",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "global",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "is",
  "lambda",
  "let",
  "new",
  "nonlocal",
  "not",
  "null",
  "or",
  "package",
  "pass",
  "private",
  "protected",
  "public",
  "raise",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * A declaration name the language accepts.
 *
 * A name of digits alone, or one that reads as a keyword, would produce a
 * snippet that does not parse, so it takes the fallback instead.
 */
function declarationName(candidate: string, fallback: string): string {
  if (candidate === "") return fallback;
  if (/^[0-9]/.test(candidate)) return fallback;
  if (RESERVED_NAMES.has(candidate)) return fallback;
  return candidate;
}

/** The function name a TypeScript snippet declares, from the agent name. */
function camelCaseOf(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "myAgent";
  const [first, ...rest] = parts as [string, ...string[]];
  const candidate =
    first.toLowerCase() +
    rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
  return declarationName(candidate, "myAgent");
}

/** The function name a Python snippet declares, from the agent name. */
function snakeCaseOf(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const candidate = parts.join("_").toLowerCase();
  return declarationName(candidate, "my_agent");
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
    ? `name=${quoted(name)}, environment=${quoted(environment)}`
    : `name=${quoted(name)}`;
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
    `    name: ${quoted(name)},`,
    environment
      ? `    environment: ${quoted(environment)},`
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

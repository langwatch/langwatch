import { exampleParameterValue } from "~/optimization_studio/utils/evaluateApiSnippet";
import type { LlmConfigInputType } from "~/types";
import type { Snippet } from "../../types";

/**
 * A variable the prompt declares. Snippets fill the compile call with these
 * exact identifiers, so the reader can paste the snippet and only replace the
 * values, never guess a name the prompt does not have.
 */
export interface PromptSnippetVariable {
  identifier: string;
  type?: LlmConfigInputType | string;
}

interface ExampleObject {
  [key: string]: ExampleValue;
}

type ExampleValue = string | number | boolean | ExampleValue[] | ExampleObject;

/**
 * Example values for common variable names. A reader scanning the snippet
 * learns more from `customer_name="Jane Doe"` than from a row of ellipses, and
 * a value of the right shape is one less thing to work out before the first
 * run. Order matters: the first pattern that matches wins.
 */
const STRING_EXAMPLES: [RegExp, string][] = [
  [/email/, "jane@example.com"],
  [/url|link|website/, "https://example.com"],
  [/name/, "Jane Doe"],
  [/company|organization|organisation/, "Acme"],
  [/country/, "Netherlands"],
  [/city/, "Amsterdam"],
  [/language|locale/, "English"],
  [/date|time|day/, "2026-01-01"],
  [/tone|style|voice/, "friendly"],
  [/topic|subject|category/, "Billing"],
  // Before the "text" pattern below, which "context" would otherwise match.
  [/summary|description|context|notes/, "The customer cannot sign in."],
  [
    /question|query|request|input|message|prompt|text|content/,
    "How do I reset my password?",
  ],
  [/id$|^id|_id_/, "abc123"],
];

function exampleStringFor(identifier: string): string {
  const name = identifier.toLowerCase();
  for (const [pattern, value] of STRING_EXAMPLES) {
    if (pattern.test(name)) return value;
  }
  return String(exampleParameterValue("str"));
}

/**
 * An example value for one declared variable, typed the way the variable was
 * declared. A string on a `float` variable is a snippet that fails the moment
 * it is run.
 */
function exampleValueFor({
  identifier,
  type,
}: PromptSnippetVariable): ExampleValue {
  switch (type) {
    case "float":
      return exampleParameterValue("float") as number;
    case "bool":
      return exampleParameterValue("bool") as boolean;
    case "image":
      return exampleParameterValue("image") as string;
    case "list":
    case "list[str]":
      return [exampleStringFor(identifier)];
    case "list[float]":
      return [exampleParameterValue("float") as number];
    case "list[int]":
      return [exampleParameterValue("int") as number];
    case "list[bool]":
      return [exampleParameterValue("bool") as boolean];
    case "dict":
      return { key: "value" };
    case "chat_messages":
      return [{ role: "user", content: exampleStringFor(identifier) }];
    default:
      return exampleStringFor(identifier);
  }
}

function toPythonLiteral(value: ExampleValue): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(toPythonLiteral).join(", ")}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${JSON.stringify(key)}: ${toPythonLiteral(item)}`,
  );
  return `{${entries.join(", ")}}`;
}

function toTypeScriptLiteral(value: ExampleValue): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replaceAll("'", "\\'")}'`;
  if (Array.isArray(value)) {
    return `[${value.map(toTypeScriptLiteral).join(", ")}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${key}: ${toTypeScriptLiteral(item)}`,
  );
  return `{ ${entries.join(", ")} }`;
}

function pythonCompileCall(variables: PromptSnippetVariable[]): string {
  if (variables.length === 0) {
    return "compiled = prompt.compile()";
  }
  const args = variables
    .map(
      (variable) =>
        `    ${variable.identifier}=${toPythonLiteral(exampleValueFor(variable))},`,
    )
    .join("\n");
  return `compiled = prompt.compile(\n${args}\n)`;
}

function typescriptCompileCall(variables: PromptSnippetVariable[]): string {
  if (variables.length === 0) {
    return "const compiled = prompt.compile();";
  }
  const args = variables
    .map(
      (variable) =>
        `  ${variable.identifier}: ${toTypeScriptLiteral(exampleValueFor(variable))},`,
    )
    .join("\n");
  return `const compiled = prompt.compile({\n${args}\n});`;
}

/**
 * Returns code snippets that get a prompt from LangWatch and compile it.
 *
 * The SDK snippets show the whole job: fetch the prompt by its handle, then
 * fill in the variables it declares. Nothing is invented except the example
 * values: the handle, the tag and the variable names all come from the prompt
 * the reader has open.
 *
 * No snippet carries a project id. The REST family behind /api/prompts
 * resolves the project from the API key, and neither the Python nor the
 * TypeScript SDK takes one.
 *
 * @param promptHandle - The handle of the prompt to retrieve (defaults to "{handle}")
 * @param apiKey - The API key to use for authentication
 * @param label - Optional label/tag to fetch (e.g. "production", "staging").
 *   When provided, uses shorthand syntax: "handle:tag" in both SDK and REST snippets.
 * @param variables - The variables the prompt declares. An empty list compiles
 *   with no arguments rather than inventing any.
 * @returns Array of code snippets for getting and compiling the prompt
 */
export function getGetPromptSnippets(params?: {
  promptHandle?: string;
  apiKey?: string;
  label?: string;
  variables?: PromptSnippetVariable[];
}): Snippet[] {
  const {
    promptHandle = "{handle}",
    apiKey = "YOUR_API_KEY",
    label,
    variables = [],
  } = params ?? {};

  // Shorthand syntax: "my-prompt:production" instead of query params
  const shorthand = label ? `${promptHandle}:${label}` : promptHandle;
  const tagSuffix = label ? ` tagged "${label}"` : "";
  const fillComment = variables.length
    ? "\n\n# Fill in the variables it declares"
    : "";
  const fillCommentJs = variables.length
    ? "\n\n// Fill in the variables it declares"
    : "";

  return [
    {
      content: `import langwatch

langwatch.setup(api_key="${apiKey}")

# Get the prompt${tagSuffix}
prompt = langwatch.prompts.get("${shorthand}")${fillComment}
${pythonCompileCall(variables)}

print(compiled.messages)
`,
      target: "python_python3",
      title: "Get and compile a prompt (Python SDK)",
      path: "/api/prompts/{id}",
      method: "GET",
    },
    {
      content: `import { LangWatch } from 'langwatch';

const langwatch = new LangWatch({ apiKey: '${apiKey}' });

// Get the prompt${tagSuffix}
const prompt = await langwatch.prompts.get('${shorthand}');${fillCommentJs}
${typescriptCompileCall(variables)}

console.log(compiled.messages);
`,
      target: "node_native",
      title: "Get and compile a prompt (TypeScript SDK)",
      path: "/api/prompts/{id}",
      method: "GET",
    },
    {
      content: `package main

import (
	"context"
	"fmt"
	"log"

	"github.com/langwatch/langwatch/sdks/go/client"
)

func main() {
	lw, err := client.New(client.WithAPIKey("${apiKey}"))
	if err != nil {
		log.Fatal(err)
	}

	// Get the prompt${tagSuffix}
	prompt, err := lw.Prompts.Get(context.Background(), "${shorthand}", nil)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(prompt.Messages)
}
`,
      target: "go_native",
      title: "Get a prompt (Go SDK)",
      path: "/api/prompts/{id}",
      method: "GET",
    },
    {
      content: `curl --request GET \\
  --url https://app.langwatch.ai/api/prompts/${shorthand} \\
  --header 'X-Auth-Token: ${apiKey}'
`,
      target: "shell_curl",
      title: "Get a prompt (cURL)",
      path: "/api/prompts/{id}",
      method: "GET",
    },
  ];
}

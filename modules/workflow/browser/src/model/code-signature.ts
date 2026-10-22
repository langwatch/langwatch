import type { Field } from "@langwatch/workflow-contract";

/** Maps a studio field type to the Python annotation used in a code signature. */
const typesMap: Record<Field["type"], string> = {
  str: "str",
  int: "int",
  float: "float",
  bool: "bool",
  image: "dspy.Image",
  file: "str",
  list: "list",
  "list[str]": "list[str]",
  "list[float]": "list[float]",
  "list[int]": "list[int]",
  "list[bool]": "list[bool]",
  dict: "dict[str, Any]",
  json_schema: "Any",
  chat_messages: "list[dict[str, Any]]",
  signature: "dspy.Signature",
  llm: "Any",
  prompting_technique: "Any",
  dataset: "Any",
  code: "str",
};

/** Rewrite entrypoint signature to match declared inputs (__call__/__forward in sync). */
export const rewriteCodeSignature = (
  code: string,
  inputs: { identifier: string; type: string }[],
): string => {
  if (inputs.length === 0) return code;

  let next = code.replace(
    /def (__call__|forward)\([\s\S]*?\)(\s*->\s*[^:\n]+)?:/,
    (_match, methodName: string, returnType: string | undefined) =>
      `def ${methodName}(self, ${inputs
        .map((i) => `${i.identifier}: ${typesMap[i.type as Field["type"]] ?? "Any"} = None`)
        .join(", ")})${returnType ?? ""}:`,
  );
  const usesAnyType = next.includes(": Any");
  const importsAnyType = next.includes("from typing import Any");
  if (usesAnyType && !importsAnyType) {
    next = `from typing import Any\n${next}`;
  }
  return next;
};

/** Splits a destructuring list on its top-level commas, so `x = [1, 2]` stays one entry. */
function splitTopLevel({ list }: { list: string }): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      entries.push(list.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(list.slice(start));
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

const JS_ENTRYPOINT =
  /(export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*[\w$]*\s*\(\s*)\{((?:[^{}]|\{[^{}]*\})*)\}/;

/**
 * Rewrites the destructured parameter of a JavaScript entrypoint to the declared inputs.
 * Surviving entries keep their text and defaults, and a `...rest` stays last; an
 * entrypoint that does not destructure its argument already sees every input.
 */
export const rewriteJavaScriptSignature = ({
  code,
  inputs,
}: {
  code: string;
  inputs: readonly { identifier: string }[];
}): string => {
  if (inputs.length === 0) return code;
  return code.replace(JS_ENTRYPOINT, (_match, head: string, list: string) => {
    const all = splitTopLevel({ list });
    const rest = all.filter((entry) => entry.startsWith("..."));
    const existing = new Map(all.map((entry) => [/^[\w$]+/.exec(entry)?.[0] ?? entry, entry]));
    const entries = inputs.map((i) => existing.get(i.identifier) ?? i.identifier);
    return `${head}{ ${[...entries, ...rest].join(", ")} }`;
  });
};

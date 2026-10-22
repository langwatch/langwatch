import type { Field } from "@langwatch/workflow-contract";

export type CodeLanguage = "python" | "javascript";

/** A code node's `language` parameter; a node without one predates JavaScript and is Python. */
export function codeLanguageOf({
  parameters,
}: {
  parameters: readonly Pick<Field, "identifier" | "value">[] | undefined;
}): CodeLanguage {
  const value = parameters?.find((p) => p.identifier === "language")?.value;
  return value === "javascript" ? "javascript" : "python";
}

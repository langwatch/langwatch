import type { Field } from "@langwatch/workflow-contract";

export type CodeLanguage = "python" | "javascript" | "typescript";

/** The languages a code node offers, in the order the picker shows them. */
export const CODE_LANGUAGES: readonly CodeLanguage[] = ["javascript", "typescript", "python"];

/** A stored language value; anything unknown, or none at all, predates JavaScript and is Python. */
export function codeLanguageFrom({ value }: { value: unknown }): CodeLanguage {
  return value === "javascript" || value === "typescript" ? value : "python";
}

/** A code node's `language` parameter; a node without one predates JavaScript and is Python. */
export function codeLanguageOf({
  parameters,
}: {
  parameters: readonly Pick<Field, "identifier" | "value">[] | undefined;
}): CodeLanguage {
  return codeLanguageFrom({
    value: parameters?.find((p) => p.identifier === "language")?.value,
  });
}

/** JavaScript and TypeScript share the ES module entrypoint and the QuickJS runtime. */
export function isEcmaScript({ language }: { language: CodeLanguage }): boolean {
  return language !== "python";
}

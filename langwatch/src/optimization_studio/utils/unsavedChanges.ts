import type { Component, Evaluator, Signature } from "../types/dsl";

/** Checks whether a node has unsaved local changes (localConfig for evaluators, localPromptConfig for signatures). */
export function hasUnsavedChanges(data: Component): boolean {
  return (
    !!(data as Evaluator).localConfig ||
    !!(data as Signature).localPromptConfig
  );
}

import type { PromptTemplateFieldsLookup } from "@langwatch/experiment-contract/mapping-validation";
import { createContext, useContext } from "react";

/**
 * Publishes, for every prompt target that carries no local draft, the variables its
 * saved template consumes. Mapping validation reads it to tell a variable the prompt
 * really uses from one it only declares.
 */
export const PromptTemplateFieldsContext = createContext<PromptTemplateFieldsLookup | undefined>(
  undefined,
);

/**
 * The template-field lookup to hand to `getTargetMissingMappings`,
 * `targetHasMissingMappings` or `validateWorkbench`.
 */
export const usePromptTemplateFields = (): PromptTemplateFieldsLookup | undefined =>
  useContext(PromptTemplateFieldsContext);

import { createContext, useContext } from "react";
import type { PromptTemplateFieldsLookup } from "../utils/mapping-validation";

/**
 * Publishes, for every prompt target that carries no local draft, the
 * variables its saved template consumes. Mapping validation reads it to tell a
 * variable the prompt really uses from one it only declares.
 *
 * The default is undefined, so a tree with no provider resolves no template
 * and validation requires nothing of an undrafted prompt target.
 * `PromptTemplateFieldsProvider` supplies the real lookup.
 */
export const PromptTemplateFieldsContext = createContext<
  PromptTemplateFieldsLookup | undefined
>(undefined);

/**
 * The template-field lookup to hand to `getTargetMissingMappings`,
 * `targetHasMissingMappings` or `validateWorkbench`.
 */
export const usePromptTemplateFields = ():
  | PromptTemplateFieldsLookup
  | undefined => useContext(PromptTemplateFieldsContext);

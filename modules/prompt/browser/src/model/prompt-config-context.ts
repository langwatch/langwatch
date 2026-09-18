/**
 * Prompt-configuration operations, published under the screen. CONTEXT lives
 * in the package model (a global layer may not import the screen that hosts
 * PROVIDER); the default throws rather than no-op, since misuse is a composition fault.
 */

import { createContext, useContext } from "react";
import type { PromptConfigContextType } from "./prompt-config-operations.ts";

const createDefaultContextValue = (): PromptConfigContextType => ({
  triggerCreatePrompt: () => {
    throw new Error("triggerCreatePrompt must be called within PromptConfigProvider");
  },
  triggerSaveVersion: () => {
    throw new Error("triggerSaveVersion must be called within PromptConfigProvider");
  },
  triggerChangeHandle: () => {
    throw new Error("triggerChangeHandle must be called within PromptConfigProvider");
  },
});

export const PromptConfigContext = createContext<PromptConfigContextType>(
  createDefaultContextValue(),
);

export const usePromptConfigContext = () => {
  const context = useContext(PromptConfigContext);
  if (!context) {
    throw new Error("usePromptConfigContext must be used within a PromptConfigProvider");
  }
  return context;
};

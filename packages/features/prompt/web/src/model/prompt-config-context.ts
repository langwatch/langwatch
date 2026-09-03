/**
 * The prompt-configuration operations, published to everything under the screen.
 *
 * The CONTEXT lives in the package model and the PROVIDER that fills it lives
 * in the screen, because the two have different reach: the provider mounts
 * three dialogs and runs three mutations, while the context is a portable value
 * that `behavior` hooks read — and a global layer may not import a screen. The
 * datasets family made the same split for its table context, for the same
 * reason.
 *
 * The default value throws rather than returning a no-op: calling one of these
 * outside the provider is a composition fault, and a silently ignored save is
 * worse than a stack trace.
 */

import { createContext, useContext } from "react";
import type { PromptConfigContextType } from "./prompt-config-operations";

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

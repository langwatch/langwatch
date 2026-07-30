import { type PromptScope as PromptScopeType } from "./types";

export const PromptScope = {
  ORGANIZATION: "ORGANIZATION" as const,
  PROJECT: "PROJECT" as const,
} satisfies Record<string, PromptScopeType>;

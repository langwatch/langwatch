import type { PromptScope } from "~/generated/prisma/client";

export interface UpdateLlmConfigDTO {
  name: string;
  handle?: string;
  scope?: PromptScope;
}

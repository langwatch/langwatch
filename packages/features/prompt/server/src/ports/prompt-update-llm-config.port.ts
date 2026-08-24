import type { PromptScope } from "../repositories/prisma/prisma.prompt.repository";

export interface UpdateLlmConfigDTO {
  name: string;
  handle?: string;
  scope?: PromptScope;
}

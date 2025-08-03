import { type PromptScope } from "@prisma/client";

export interface UpdateLlmConfigDTO {
  name: string;
  handle?: string;
  scope?: PromptScope;
}

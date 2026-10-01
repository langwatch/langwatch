import type { PromptTagAssignmentRepository } from "./prompt-tag-assignment.repository.ts";
import type { PromptTagRepository } from "./prompt-tag.repository.ts";
import type { LlmConfigRepository } from "./prompt.repository.ts";

/** The owned persistence collaborators a Prompt service is constructed over. */
export interface PromptRepositories {
  readonly configs: LlmConfigRepository;
  readonly tags: PromptTagRepository;
  readonly tagAssignments: PromptTagAssignmentRepository;
}

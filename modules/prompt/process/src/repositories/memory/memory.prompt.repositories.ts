import type { PromptRepositories } from "../prompt.repositories.ts";
import { MemoryPromptState } from "./memory-prompt.state.ts";
import { MemoryPromptTagAssignmentRepository } from "./memory.prompt-tag-assignment.repository.ts";
import { MemoryPromptTagRepository } from "./memory.prompt-tag.repository.ts";
import { MemoryLlmConfigRepository } from "./memory.prompt.repository.ts";

export class MemoryPromptRepositories {
  static readonly requires = [] as const;

  static create(): PromptRepositories {
    const state = new MemoryPromptState();

    return {
      configs: MemoryLlmConfigRepository.create(state),
      tags: MemoryPromptTagRepository.create(state),
      tagAssignments: MemoryPromptTagAssignmentRepository.create(state),
    };
  }
}

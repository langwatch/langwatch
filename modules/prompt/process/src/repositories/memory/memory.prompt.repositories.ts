import type { PromptRepositories } from "../prompt.repositories.ts";
import { MemoryPromptRateLimitRepository } from "./memory.prompt-rate-limit.repository.ts";
import { MemoryPromptTagAssignmentRepository } from "./memory.prompt-tag-assignment.repository.ts";
import { MemoryPromptTagRepository } from "./memory.prompt-tag.repository.ts";
import { MemoryLlmConfigRepository } from "./memory.prompt.repository.ts";
import { MemoryPromptState } from "./memory.prompt.store.ts";

export class MemoryPromptRepositories {
  static readonly requires = [] as const;

  static create(): PromptRepositories {
    const state = new MemoryPromptState();

    return {
      configs: MemoryLlmConfigRepository.create(state),
      tags: MemoryPromptTagRepository.create(state),
      tagAssignments: MemoryPromptTagAssignmentRepository.create(state),
      rateLimits: MemoryPromptRateLimitRepository.create(),
    };
  }
}

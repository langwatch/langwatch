import type { TopicRepositories } from "../topic.repositories.ts";
import { MemoryTopicRepository } from "./memory.topic.repository.ts";

export class MemoryTopicRepositories {
  static readonly requires = [] as const;

  static create(): TopicRepositories {
    return { topics: MemoryTopicRepository.create() };
  }
}

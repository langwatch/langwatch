import type { TopicRepository } from "./topic.repository.ts";

export interface TopicRepositories {
  readonly topics: TopicRepository;
}

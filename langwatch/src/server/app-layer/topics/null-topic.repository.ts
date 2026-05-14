import type { TopicRepository } from "./topic.repository";

export class NullTopicRepository implements TopicRepository {
  async findNamesByIds(): Promise<Map<string, string>> {
    return new Map();
  }
}

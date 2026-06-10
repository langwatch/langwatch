import type { TopicRepository } from "./topic.repository";

export class TopicService {
  constructor(private readonly repository: TopicRepository) {}

  async getNamesByIds(
    projectId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    return this.repository.findNamesByIds(projectId, ids);
  }
}

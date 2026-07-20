import type { TopicRepository } from "./repositories/topic.repository";

/**
 * Read surface for the projected topic model — every topic list or name
 * lookup goes through here, never straight at the table.
 */
export class TopicService {
  constructor(private readonly repository: TopicRepository) {}

  async getNamesByIds(
    projectId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    return this.repository.findNamesByIds(projectId, ids);
  }

  async getAll(params: { projectId: string }) {
    return this.repository.findAll(params);
  }
}

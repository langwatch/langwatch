import type { TopicRepository } from "./repositories/topic.repository";

/**
 * Read surface for the projected topic model — every topic list or name
 * lookup goes through here, never straight at the table.
 */
export class TopicService {
  constructor(private readonly repository: TopicRepository) {}

  /**
   * Names for topic ids owned by any of `projectIds`. A proof can span
   * several projects (an aggregate lists its members' traces), so the lookup
   * names every project the caller may read.
   */
  async getNamesByIds(params: {
    projectIds: readonly string[];
    ids: readonly string[];
  }): Promise<Map<string, string>> {
    return this.repository.findNamesByIds(params);
  }

  async getAll(params: { projectId: string }) {
    return this.repository.findAll(params);
  }
}

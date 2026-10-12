/**
 * Read-only access to the projected topic model (the Topic table, written
 * only by the topicModel projection). Enriches CH-derived facet values
 * (TopicId/SubTopicId) with names and backs the topic list surfaces.
 */
export interface TopicRepository {
  /**
   * Returns a map of topicId -> name for the topics owned by any of
   * `projectIds`. Missing IDs, and IDs owned by another project, are simply
   * absent. A topic id is the primary key, so it names one topic.
   */
  findNamesByIds(params: {
    projectIds: readonly string[];
    ids: readonly string[];
  }): Promise<Map<string, string>>;
  findAll(params: { projectId: string }): Promise<
    Array<{
      id: string;
      name: string;
      parentId: string | null;
      automaticallyGenerated: boolean;
    }>
  >;
}

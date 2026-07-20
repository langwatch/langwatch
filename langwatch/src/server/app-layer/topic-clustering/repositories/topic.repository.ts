/**
 * Read-only access to the projected topic model (the Topic table, written
 * only by the topicModel projection). Enriches CH-derived facet values
 * (TopicId/SubTopicId) with names and backs the topic list surfaces.
 */
export interface TopicRepository {
  /** Returns a map of topicId -> name. Missing IDs are simply absent. */
  findNamesByIds(params: {
    projectId: string;
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

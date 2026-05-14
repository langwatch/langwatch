/**
 * Lightweight read-only access to topic metadata that lives in Postgres.
 * Used to enrich CH-derived facet values (which are TopicId/SubTopicId) with
 * human-readable names for the sidebar UI.
 */
export interface TopicRepository {
  /** Returns a map of topicId -> name. Missing IDs are simply absent. */
  findNamesByIds(
    projectId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>>;
}

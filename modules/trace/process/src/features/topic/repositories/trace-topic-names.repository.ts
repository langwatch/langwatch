/**
 * Topic's names as trace reads them through topic's shared table.
 * Spec: modules/trace/specs/trace-topic-names.feature
 */
export abstract class TraceTopicNamesReadRepository {
  /** Names of the project's topics among `ids`; an unknown topic is absent from the map. */
  abstract findNamesByIds(args: { projectId: string; ids: string[] }): Promise<Map<string, string>>;
}

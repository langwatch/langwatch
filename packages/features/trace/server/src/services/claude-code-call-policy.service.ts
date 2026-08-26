const CONVERSATIONAL_QUERY_SOURCES: ReadonlySet<string> = new Set([
  "repl_main_thread",
  "sdk",
]);

export const isConversationalQuerySource = (querySource: string | null): boolean =>
  querySource === null || CONVERSATIONAL_QUERY_SOURCES.has(querySource);

/**
 * Prices main-thread cache writes as one-hour entries. Unknown contexts remain
 * short-lived so a provider change cannot overstate cost.
 */
export const claudeCacheWritesLongLived = ({
  llmRequestContext,
  querySource,
}: {
  llmRequestContext?: string | null;
  querySource?: string | null;
}): boolean => llmRequestContext === "interaction" || querySource === "repl_main_thread";

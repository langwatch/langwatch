const CONVERSATIONAL_QUERY_SOURCES: Readonly<Record<string, true>> = {
  repl_main_thread: true,
  sdk: true,
};

export const isConversationalQuerySource = (querySource: string | null): boolean =>
  querySource === null || CONVERSATIONAL_QUERY_SOURCES[querySource] === true;

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

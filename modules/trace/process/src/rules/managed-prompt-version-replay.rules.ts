/** The replay of trace_analytics rows so they carry the managed prompt version they used. */

/** The replay step that refolds trace_analytics rows so they carry LastUsedPromptVersionId. */
export const MANAGED_PROMPT_VERSION_REPLAY_STEP_ID =
  "trace:replay-trace-analytics-managed-prompt-version";

/** How far back that replay reaches: att-change's 60-day period and the 60 before it, plus two. */
export const MANAGED_VERSION_REPLAY_HOURS = 122 * 24;

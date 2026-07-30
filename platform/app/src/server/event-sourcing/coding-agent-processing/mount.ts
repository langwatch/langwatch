import {
  ConfigurationError,
  type Mount,
  validateMount,
} from "@langwatch/event-sourcing";

/** `batch` because one delivery may carry several contributions for one
 *  session, applied in order as a single unit of work. */
export const codingAgentSessionMount: Mount = {
  projection: "fold",
  store: "replace",
  scope: "aggregate",
  collapse: "batch",
};

/** No accumulator; the store's `ReplacingMergeTree` collapses a redelivered
 *  `(TenantId, TraceId)` pair at merge. */
export const codingAgentTraceSessionsMount: Mount = {
  projection: "map",
  store: "append",
  scope: "aggregate",
  collapse: "batch",
};

/** Each contribution independently produces one row; the store's engine
 *  collapses a redelivered `(SessionId, Kind, SourceId)` key at merge. */
export const codingAgentSessionContributionsMount: Mount = {
  projection: "map",
  store: "append",
  scope: "aggregate",
  collapse: "batch",
};

function assertMountIsLegal(name: string, mount: Mount): void {
  const violations = validateMount(mount);
  if (violations.length > 0) {
    throw new ConfigurationError(
      `coding-agent-processing's ${name} mount is illegal: ${violations
        .map((v) => `${v.rule} — ${v.message}`)
        .join("; ")}`,
      { pipeline: "coding_agent_processing", projection: name, violations },
    );
  }
}

export function assertCodingAgentProcessingMountsAreLegal(): void {
  assertMountIsLegal("codingAgentSession", codingAgentSessionMount);
  assertMountIsLegal("codingAgentTraceSessions", codingAgentTraceSessionsMount);
  assertMountIsLegal("codingAgentSessionContributions", codingAgentSessionContributionsMount);
}

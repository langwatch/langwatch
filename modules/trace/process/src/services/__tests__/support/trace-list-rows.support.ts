/** A list row as the repository returns it: the fields the list mapper and the cursor read. */
export function listedRow({
  tenantId,
  traceId,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
}) {
  return {
    tenantId,
    traceId,
    spanCount: 1,
    totalDurationMs: 10,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    containsErrorStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    rootSpanType: null,
    attributes: {},
    traceName: "",
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    LastEventOccurredAt: occurredAt,
  };
}

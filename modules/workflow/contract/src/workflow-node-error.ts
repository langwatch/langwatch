import {
  type HandledErrorFault,
  handledErrorFromHerr,
  type SerializedHandledError,
} from "@langwatch/handled-error";

const CUSTOMER_FAULT_CODES = new Set([
  "invalid_dataset",
  "invalid_workflow",
  "invalid_condition",
  "unsupported_node_kind",
  "code_runner_error",
  "code_block_timeout",
  "ssrf_blocked",
  "http_error",
  "upstream_http_error",
  "context_canceled",
  "llm_model_not_set",
  "jsonpath_no_match",
  "agent_missing_type",
  "agent_unknown_type",
  "agent_missing_workflow_id",
  "custom_missing_workflow_id",
  "evaluator_missing_slug",
]);

const PROVIDER_FAULT_CODES = new Set([
  "llm_error",
  "evaluator_error",
  "agent_workflow_error",
  "custom_workflow_error",
]);

/**
 * Maps an engine node failure to the portable error shown by Workflow clients.
 * The raw engine message remains server-side; the stable code is serialized.
 */
export function nodeErrorToDomainError({
  errorType,
  message,
  upstreamStatus,
  traceId,
  spanId,
}: {
  errorType: string;
  message?: string;
  upstreamStatus?: number;
  traceId?: string;
  spanId?: string;
}): SerializedHandledError {
  return handledErrorFromHerr(
    {
      type: errorType,
      message: message ?? errorType,
      ...(upstreamStatus ? { meta: { upstreamStatus } } : {}),
      trace_id: traceId,
      span_id: spanId,
      fault: nodeErrorFault({ errorType, upstreamStatus }),
    },
    { httpStatus: upstreamStatus ?? 502 },
  ).serialize();
}

function nodeErrorFault({
  errorType,
  upstreamStatus,
}: {
  errorType: string;
  upstreamStatus?: number;
}): HandledErrorFault {
  if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500) {
    return "customer";
  }

  if (upstreamStatus && upstreamStatus >= 500) {
    return "provider";
  }

  if (CUSTOMER_FAULT_CODES.has(errorType)) {
    return "customer";
  }

  if (PROVIDER_FAULT_CODES.has(errorType)) {
    return "provider";
  }

  return "platform";
}

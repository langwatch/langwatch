import {
  type HandledErrorFault,
  handledErrorFromHerr,
  type SerializedHandledError,
} from "@langwatch/handled-error";

/**
 * Turns the nlpgo engine's structured node failure into a
 * `SerializedHandledError` the client renders from its code.
 *
 * The engine already carries a stable code (`NodeError.Type` →
 * `execution_state.error_type`: `http_error`, `upstream_http_error`,
 * `llm_error`, …), but the streamed event historically flattened it to just
 * the raw message string, which then reached the customer verbatim
 * (`httpblock: Post "…": no such host`). This lifts the code onto the handled
 * channel — mirroring the evaluator side, which already ships
 * `domainError: evalError.serialize()`.
 *
 * Built through `handledErrorFromHerr` so the same adapter that decodes real
 * Go `herr` envelopes produces this one: the raw message rides as the handled
 * error's server-side `message`, which `SerializedHandledError` deliberately
 * omits (#5984), so the CODE is what the client presents from.
 *
 * The raw string does still reach one surface, deliberately: the evaluator
 * grid ships it as `details` and `ComparisonCell` puts it behind a "show
 * details" popover. That is not a contradiction of the rule, it is the rule —
 * registry copy is what a customer READS, and the engine's own words are
 * available on request to the person debugging the workflow they wrote. What
 * is forbidden is the raw string appearing as a headline, a toast body, or
 * anything a customer sees without asking for it.
 *
 * Lives outside `~/server` on purpose: `explainExecutionStateError` runs in the
 * browser and needs the same mapping, and a client bundle reaching into a
 * server module is one server-only import away from breaking.
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
      // Server copy only — kept for logs, never serialised to the client.
      message: message ?? errorType,
      // `upstream_status` is the one meta field the registry reads (the
      // `upstream_http_error` copy names the status); everything else is a
      // node-execution detail the customer never sees.
      ...(upstreamStatus ? { meta: { upstreamStatus } } : {}),
      trace_id: traceId,
      span_id: spanId,
      fault: nodeErrorFault({ errorType, upstreamStatus }),
    },
    // No HTTP boundary for a streamed node error; use the upstream status when
    // present, else a downstream-failure default.
    { httpStatus: upstreamStatus ?? 502 },
  ).serialize();
}

/** Node codes the customer owns: their workflow, dataset, code, or endpoint. */
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

/** Node codes owned by a third party we called out to. */
const PROVIDER_FAULT_CODES = new Set([
  "llm_error",
  "evaluator_error",
  "agent_workflow_error",
  "custom_workflow_error",
  "attachment_fetch_error",
]);

/**
 * Who a node failure is on.
 *
 * Follows `classifyNodeFault` in `services/nlpgo/app/engine/faults.go`, which
 * already answers this for the engine's own log level: an upstream status wins
 * when present, then the code decides, then a default. The two drifting apart
 * means the customer reads one story while the operator reads another.
 *
 * The code sets here are a superset of Go's — the node-configuration codes
 * (`agent_missing_type`, `llm_model_not_set`, `evaluator_missing_slug`, …) are
 * plainly the customer's and Go's list has not caught up with them. Anything
 * neither list names lands on the default.
 *
 * This used to be hard-coded to `"provider"` under a comment claiming the
 * fallback was unreachable because the registry covers every node code. It is
 * not: `engine.go` forwards the code runner's own error type through
 * (`&NodeError{Type: res.Error.Type}`), so a Python `ValueError` in a code
 * node arrives as the code `ValueError` — unregistered, and squarely the
 * customer's. Telling them "a connected service didn't respond" sends them
 * looking at our integrations for a bug in their own function.
 *
 * An unrecognised code defaults to `platform`, matching the engine: when we
 * genuinely do not know, saying it is on us is the honest answer and the one
 * that gets somebody looking.
 */
function nodeErrorFault({
  errorType,
  upstreamStatus,
}: {
  errorType: string;
  upstreamStatus?: number;
}): HandledErrorFault {
  // An upstream status wins when present: 4xx means the upstream rejected
  // this caller, 5xx means the upstream itself failed.
  if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500) {
    return "customer";
  }
  if (upstreamStatus && upstreamStatus >= 500) return "provider";

  if (CUSTOMER_FAULT_CODES.has(errorType)) return "customer";
  if (PROVIDER_FAULT_CODES.has(errorType)) return "provider";
  return "platform";
}

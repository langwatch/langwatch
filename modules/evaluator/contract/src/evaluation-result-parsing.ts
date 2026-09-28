import {
  serializedHandledErrorSchema,
  type SerializedHandledError,
} from "@langwatch/handled-error";

/**
 * One evaluation result, as every surface that renders one reads it.
 * `processed` carries a score with no pass or fail; `skipped` never ran.
 */
export type ParsedEvaluationResult = {
  status: "pending" | "running" | "passed" | "failed" | "processed" | "error" | "skipped";
  score?: number;
  label?: string;
  details?: string;
  domainError?: SerializedHandledError;
};

function parseSerializedDomainError(candidate: unknown): SerializedHandledError | undefined {
  const result = serializedHandledErrorSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

/**
 * Reads a raw evaluation result into that shape: a boolean, an object carrying
 * `passed` / `score` / `label` / `details`, an error, or nothing at all.
 */
export const parseEvaluationResult = (result: unknown): ParsedEvaluationResult => {
  if (result === null || result === undefined) return { status: "pending" };
  if (result === "running") return { status: "running" };
  if (typeof result === "boolean") return { status: result ? "passed" : "failed" };
  if (typeof result === "object") return parseEvaluationResultObject(result);
  return { status: "pending" };
};

/** Running first, then an error in either shape, then skipped, then the outcome fields. */
function parseEvaluationResultObject(obj: object): ParsedEvaluationResult {
  const status = "status" in obj ? obj.status : undefined;
  if (status === "running") return { status: "running" };

  const domainError = parseSerializedDomainError(
    "domainError" in obj ? obj.domainError : undefined,
  );
  if ("error" in obj && obj.error) {
    const details = typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error);
    return { status: "error", details, domainError };
  }
  if (status === "error") return { status: "error", ...detailsOf(obj), domainError };
  if (status === "skipped") return { status: "skipped", ...detailsOf(obj) };

  return outcomeOf(obj);
}

function detailsOf(obj: object): Pick<ParsedEvaluationResult, "details"> {
  return "details" in obj && typeof obj.details === "string" ? { details: obj.details } : {};
}

/** An explicit pass or fail wins; results without one read as processed. */
function outcomeOf(obj: object): ParsedEvaluationResult {
  const parsed: ParsedEvaluationResult = {
    status: "pending",
    ...("score" in obj && typeof obj.score === "number" ? { score: obj.score } : {}),
    ...("label" in obj && typeof obj.label === "string" ? { label: obj.label } : {}),
    ...detailsOf(obj),
  };
  if ("passed" in obj && obj.passed !== null && obj.passed !== undefined) {
    return { ...parsed, status: obj.passed ? "passed" : "failed" };
  }
  const hasResults =
    parsed.score !== undefined || parsed.label !== undefined || parsed.details !== undefined;
  return hasResults ? { ...parsed, status: "processed" } : parsed;
}

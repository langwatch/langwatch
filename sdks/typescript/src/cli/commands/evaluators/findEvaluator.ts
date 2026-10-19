import type { EvaluatorResponse, EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { LangWatchHandledError } from "@/internal/api/errors";

import { commandValidationError } from "../../utils/errorOutput";
import { pickByReference, ReferenceNotResolvedError } from "../../utils/pickByReference";

const isEvaluatorNotFound = (error: unknown): boolean =>
  error instanceof LangWatchHandledError && error.code === "evaluator_not_found";

/**
 * The evaluator a reference names: the exact id or slug lookup first, then,
 * only when that finds nothing, the display name among every evaluator.
 */
export const findEvaluator = async ({
  service,
  reference,
}: {
  service: Pick<EvaluatorsApiService, "get" | "getAll">;
  reference: string;
}): Promise<EvaluatorResponse> => {
  try {
    return await service.get(reference);
  } catch (error) {
    if (!isEvaluatorNotFound(error)) throw error;
  }
  return pickByReference({
    rows: await service.getAll(),
    reference,
    what: "evaluator",
    scope: "project",
    listCommand: "langwatch evaluator list",
  });
};

/** A validation failure for a name-resolution refusal, any other error unchanged. */
export const asCommandError = (error: unknown): unknown =>
  error instanceof ReferenceNotResolvedError
    ? Object.assign(new Error(error.message), commandValidationError(error.message))
    : error;

/**
 * For commands that take an exact id or slug: a miss gets told how to find the id,
 * since a display name is not accepted there.
 */
export const explainExactLookupMiss = ({
  error,
  reference,
}: {
  error: unknown;
  reference: string;
}): unknown => {
  if (!isEvaluatorNotFound(error)) return error;
  const message = `No evaluator with the id or slug "${reference}". Find its id with \`langwatch evaluator get <name>\` or \`langwatch evaluator list\`, then pass the id.`;
  return Object.assign(new Error(message), commandValidationError(message));
};

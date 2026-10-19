import type { EvaluatorResponse, EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { LangWatchHandledError } from "@/internal/api/errors";

import { commandValidationError } from "../../utils/errorOutput";
import { pickByReference, ReferenceNotResolvedError } from "../../utils/pickByReference";

// Same shape the platform sends, with only the message replaced. A plain Error would be
// read as `network_error` at status 0.
const evaluatorNotFoundError = (message: string): Error =>
  Object.assign(new Error(message), {
    isLangWatchHandledError: true,
    code: "evaluator_not_found",
    kind: "evaluator_not_found",
    message,
    httpStatus: 404,
    meta: {},
    isHandled: true,
    retryable: false,
  });

const isEvaluatorNotFound = (error: unknown): boolean =>
  error instanceof LangWatchHandledError && error.code === "evaluator_not_found";

// `get` uses findEvaluator (exact lookup, then name only; the id/slug re-checks in
// pickByReference are harmless). `delete`/`update` take an id or slug and use exactLookupMissError.

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

/**
 * A name-resolution refusal as a command error. A miss keeps the platform's
 * `evaluator_not_found` shape, so agents read the not-found signal and get its advice;
 * an ambiguous name is an input problem and stays a validation error.
 */
export const refusalFromReference = (error: unknown): unknown => {
  if (!(error instanceof ReferenceNotResolvedError)) return error;
  return error.reason === "none"
    ? evaluatorNotFoundError(error.message)
    : Object.assign(new Error(error.message), commandValidationError(error.message));
};

/** The miss text for commands that take an exact id or slug, where a name is not accepted. */
export const exactLookupMissMessage = (reference: string): string =>
  `No evaluator with the id or slug "${reference}". Find its id with ` +
  "`langwatch evaluator get <name>` or `langwatch evaluator list`, then pass the id.";

/** For delete/update: a platform not-found gets the exact-lookup message, other errors pass. */
export const exactLookupMissError = ({
  error,
  reference,
}: {
  error: unknown;
  reference: string;
}): unknown =>
  isEvaluatorNotFound(error) ? evaluatorNotFoundError(exactLookupMissMessage(reference)) : error;

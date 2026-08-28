import type { DefaultErrorShape } from "@trpc/server";
import { HandledError, isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { AiCallFailedError } from "~/server/modelProviders/aiCallFailedError";
import { ModelProviderDisabledError } from "~/server/modelProviders/modelProviderDisabledError";
import { trpcFailureTraceIds } from "./trpc.failure-trace";

const MAX_CAUSE_DEPTH = 3;

function donatedMessage(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const message = (cause as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function isInheritedFromCause(message: string, cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current === null || current === undefined) return false;

    const donated = donatedMessage(current);
    if (donated !== undefined && message.includes(donated)) return true;
    if (typeof current !== "object") return true;

    current = (current as { cause?: unknown }).cause;
  }
  return current !== null && current !== undefined;
}

/**
 * App tRPC's handled-error wire boundary. It deliberately remains app-owned:
 * its model-provider compatibility payloads are browser contracts, not API
 * framework policy.
 */
export function errorFormatter({
  shape,
  error,
}: {
  shape: DefaultErrorShape;
  error: { cause?: unknown; message?: string; code?: string };
}) {
  const cause = error.cause as { limitType?: string; current?: number; max?: number } | undefined;
  const limitInfo = cause?.limitType
    ? { limitType: cause.limitType, current: cause.current, max: cause.max }
    : null;
  const handled = HandledError.isHandled(error.cause)
    ? error.cause
    : isZodLikeError(error.cause)
      ? ValidationError.fromZodError(error.cause)
      : null;
  const missingModelCause =
    error.cause instanceof ModelNotConfiguredError
      ? {
          code: error.cause.cause,
          featureKey: error.cause.featureKey,
          featureDisplayName: error.cause.featureDisplayName,
          role: error.cause.role,
          projectId: error.cause.projectId,
        }
      : null;
  const aiCallFailedCause =
    error.cause instanceof AiCallFailedError
      ? {
          code: error.cause.cause,
          featureKey: error.cause.featureKey,
          featureDisplayName: error.cause.featureDisplayName,
          role: error.cause.role,
        }
      : null;
  const providerDisabledCause =
    error.cause instanceof ModelProviderDisabledError ? error.cause.toResponseBody() : null;
  const isInternalServerError =
    error.code === "INTERNAL_SERVER_ERROR" || shape?.data?.code === "INTERNAL_SERVER_ERROR";
  const message = handled
    ? handled.code
    : isInternalServerError
      ? HandledError.toUserMessage(error.cause)
      : shape.message;
  const isAuthoredMessage =
    !handled &&
    !isInternalServerError &&
    typeof shape.message === "string" &&
    shape.message.length > 0 &&
    shape.message !== error.code &&
    !isInheritedFromCause(shape.message, error.cause);
  const shapeData = { ...shape.data };
  delete shapeData.stack;

  return {
    ...shape,
    message,
    data: {
      ...shapeData,
      cause: missingModelCause ?? providerDisabledCause ?? aiCallFailedCause ?? limitInfo,
      error: handled?.serialize() ?? null,
      authored: isAuthoredMessage,
      traceId: trpcFailureTraceIds.find(error),
    },
  };
}

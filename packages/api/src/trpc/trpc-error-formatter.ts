/**
 * The wire shape a failed tRPC call arrives in.
 *
 * The framework half is here: a handled error is serialised under
 * `data.error`, its code replaces the message so no unreviewed prose reaches a
 * customer, the stack is stripped, and the trace id captured while the span was
 * live is attached. The application half — which typed causes a client
 * interceptor renders, and what it needs from them — arrives through a port,
 * because those payloads are browser contracts rather than API framework
 * policy.
 */
import type { TRPCDefaultErrorShape } from "@trpc/server";
import { HandledError, isZodLikeError, ValidationError } from "@langwatch/handled-error";
import type { TrpcFailureTraceIds } from "./trpc-failure-trace.js";

const MAX_CAUSE_DEPTH = 3;

/**
 * The application payload a client interceptor reads off `data.cause`, for the
 * causes this package does not own. Answers null when the cause is not one of
 * them — which is what the legacy formatter already put on the wire.
 */
export interface TrpcErrorCausePayloadPort {
  payloadFor(cause: unknown): unknown;
}

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

export function createTrpcErrorFormatter(
  ports: Readonly<{
    causePayload: TrpcErrorCausePayloadPort;
    traceIds: TrpcFailureTraceIds;
  }>,
) {
  return function errorFormatter({
    shape,
    error,
  }: {
    shape: TRPCDefaultErrorShape;
    error: { cause?: unknown; message?: string; code?: string };
  }) {
    const handled = HandledError.isHandled(error.cause)
      ? error.cause
      : isZodLikeError(error.cause)
        ? ValidationError.fromZodError(error.cause)
        : null;
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
        cause: ports.causePayload.payloadFor(error.cause),
        error: handled?.serialize() ?? null,
        authored: isAuthoredMessage,
        traceId: ports.traceIds.find(error),
      },
    };
  };
}

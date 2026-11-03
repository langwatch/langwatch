import { LangWatchHandledError } from "@/internal/api/errors";

/** A platform-shaped 404 handled error carrying the given code. */
export const handledError = (code: string): LangWatchHandledError =>
  new LangWatchHandledError({
    handled: {
      code,
      kind: code,
      message: "boom",
      httpStatus: 404,
      meta: {},
      isHandled: true,
      retryable: false,
      traceId: undefined,
      traceUrl: undefined,
      reasons: undefined,
      suggestions: undefined,
      docUrl: undefined,
    },
    body: { error: code },
    operation: "get evaluator",
    message: "boom",
  });

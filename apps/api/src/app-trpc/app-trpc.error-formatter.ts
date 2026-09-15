import {
  createTrpcErrorFormatter,
  trpcFailureTraceIds,
  type TrpcErrorCausePayload,
} from "@langwatch/api/trpc";
import {
  ModelNotConfiguredError,
  ModelProviderDisabledError,
} from "@langwatch/model-provider-contract";
import { AiCallFailedError } from "@langwatch/model-provider-server";

// Error cause payloads for frontend interceptors. Model-provider shapes are
// browser contracts, not API framework policy; they reach as a port.
const causePayload: TrpcErrorCausePayload = {
  payloadFor(cause) {
    if (cause instanceof ModelNotConfiguredError) {
      return {
        code: cause.cause,
        featureKey: cause.featureKey,
        featureDisplayName: cause.featureDisplayName,
        role: cause.role,
        projectId: cause.projectId,
      };
    }
    if (cause instanceof ModelProviderDisabledError) {
      return cause.toResponseBody();
    }
    if (cause instanceof AiCallFailedError) {
      return {
        code: cause.cause,
        featureKey: cause.featureKey,
        featureDisplayName: cause.featureDisplayName,
        role: cause.role,
      };
    }
    const limit = cause as { limitType?: string; current?: number; max?: number } | undefined;
    return limit?.limitType
      ? { limitType: limit.limitType, current: limit.current, max: limit.max }
      : null;
  },
};

/** This process's tRPC handled-error wire boundary. */
export const appTrpcErrorFormatter = createTrpcErrorFormatter({
  causePayload,
  traceIds: trpcFailureTraceIds,
});

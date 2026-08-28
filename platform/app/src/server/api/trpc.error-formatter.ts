import {
  createTrpcErrorFormatter,
  trpcFailureTraceIds,
  type TrpcErrorCausePayloadPort,
} from "@langwatch/api/trpc";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { AiCallFailedError } from "~/server/modelProviders/aiCallFailedError";
import { ModelProviderDisabledError } from "~/server/modelProviders/modelProviderDisabledError";

/**
 * The `data.cause` payloads this app's frontend interceptors read. They stay
 * app-owned deliberately: the model-provider compatibility shapes are browser
 * contracts, not API framework policy, so they reach the framework formatter
 * as a port rather than being moved into it.
 *
 * Order matters only in that a cause is one of these or none of them; the
 * plan-limit shape is last because it is the shapeless one, recognised by a
 * field rather than by a class.
 */
const causePayload: TrpcErrorCausePayloadPort = {
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

/** App tRPC's handled-error wire boundary. */
export const errorFormatter = createTrpcErrorFormatter({
  causePayload,
  traceIds: trpcFailureTraceIds,
});

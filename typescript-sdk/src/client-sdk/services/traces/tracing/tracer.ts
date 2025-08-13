import { LANGWATCH_SDK_NAME_CLIENT, LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { getLangWatchTracer } from "@/observability-sdk/tracer";

export const tracer = getLangWatchTracer(`${LANGWATCH_SDK_NAME_CLIENT}.traces`, LANGWATCH_SDK_VERSION);

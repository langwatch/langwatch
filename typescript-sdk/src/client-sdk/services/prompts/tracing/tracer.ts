import { getLangWatchTracer } from "@/observability-sdk/tracer";
import { LANGWATCH_SDK_NAME_CLIENT, LANGWATCH_SDK_VERSION } from "@/internal/constants";

export const tracer = getLangWatchTracer(`${LANGWATCH_SDK_NAME_CLIENT}.prompts`, LANGWATCH_SDK_VERSION);

export { getLangWatchTracer, type LangWatchSpan } from "./observability";
export {
  FilterableBatchSpanProcessor,
  type SpanProcessingExcludeRule,
} from "./observability/processors";
export { LangWatchExporter } from "./observability/exporters";

export { recordEvaluation, runEvaluation } from "./evaluation";

export { getPrompt, getPromptVersion } from "./prompt";

import { PromptFacade } from "./prompt/facade";

export const prompts = PromptFacade.getInstance();

import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type { CheckTypes, Checks, TraceCheckResult } from "../types";
import { customCheck } from "./customCheck";
import { inconsistencyCheck } from "./inconsistencyCheck";
import { jailbreakCheck } from "./jailbreakCheck";
import { languageCheck } from "./languageCheck";
import { piiCheck } from "./piiCheck";
import { ragasAnswerRelevancy } from "./ragasAnswerRelevancy";
import { ragasContextUtilization } from "./ragasContextUtilization";
import { ragasFaithfulness } from "./ragasFaithfulness";
import { toxicityCheck } from "./toxicityCheck";

export const TRACE_CHECKS_EXECUTORS: {
  [K in CheckTypes]: (
    trace: Trace,
    spans: ElasticSearchSpan[],
    parameters: Checks[K]["parameters"]
  ) => Promise<TraceCheckResult>;
} = {
  pii_check: piiCheck,
  toxicity_check: toxicityCheck,
  custom: customCheck,
  jailbreak_check: jailbreakCheck,
  ragas_answer_relevancy: ragasAnswerRelevancy,
  ragas_faithfulness: ragasFaithfulness,
  ragas_context_utilization: ragasContextUtilization,
  inconsistency_check: inconsistencyCheck,
  language_check: languageCheck,
};

export const getCheckExecutor = (checkType: string) => {
  for (const [key, val] of Object.entries(TRACE_CHECKS_EXECUTORS)) {
    if (key === checkType) return val;
  }
  return undefined;
};

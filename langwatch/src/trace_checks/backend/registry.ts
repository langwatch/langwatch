import type { CheckTypes, TraceCheckBackendDefinition } from "../types";
import { PIICheck } from "./piiCheck";
import { ToxicityCheck } from "./toxicityCheck";
import { CustomCheck } from "./customCheck";
import { JailbreakCheck } from "./jailbreakCheck";
import { InconsistencyCheck } from "./inconsistencyCheck";
import { RagasAnswerRelevancy } from "./ragasAnswerRelevancy";
import { RagasFaithfulness } from "./ragasFaithfulness";
import { RagasContextPrecision } from "./ragasContextPrecision";

// TODO: allow checks to be run to be configurable by user
export const AVAILABLE_TRACE_CHECKS: {
  [K in CheckTypes]: TraceCheckBackendDefinition<K>;
} = {
  pii_check: PIICheck,
  toxicity_check: ToxicityCheck,
  custom: CustomCheck,
  jailbreak_check: JailbreakCheck,
  ragas_answer_relevancy: RagasAnswerRelevancy,
  ragas_faithfulness: RagasFaithfulness,
  ragas_context_precision: RagasContextPrecision,
  inconsistency_check: InconsistencyCheck,
};

export const getCheckExecutor = (checkType: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_TRACE_CHECKS)) {
    if (key === checkType) return val;
  }
  return undefined;
};

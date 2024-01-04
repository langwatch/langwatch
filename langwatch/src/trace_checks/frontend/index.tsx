import type { CheckTypes } from "../types";
import { CustomCheck } from "./customCheck";
import { PIICheck } from "./piiCheck";
import { ToxicityCheck } from "./toxicityCheck";
import { JailbreakCheck } from "./jailbreakCheck";
import { InconsistencyCheck } from "./inconsistencyCheck";
import { RagasAnswerRelevancy } from "./ragasAnswerRelevancy";
import { RagasFaithfulness } from "./ragasFaithfulness";
import { RagasContextPrecision } from "./ragasContextPrecision";
import type { TraceCheck } from "../../server/tracer/types";

export const RENDER_TRACE_CHECKS: {
  [K in CheckTypes]: (props: { check: TraceCheck }) => JSX.Element;
} = {
  pii_check: PIICheck,
  toxicity_check: ToxicityCheck,
  jailbreak_check: JailbreakCheck,
  ragas_answer_relevancy: RagasAnswerRelevancy,
  ragas_faithfulness: RagasFaithfulness,
  ragas_context_precision: RagasContextPrecision,
  inconsistency_check: InconsistencyCheck,
  custom: CustomCheck,
};

export function TraceCheckDetails({ check }: { check: TraceCheck }) {
  const Renderer = RENDER_TRACE_CHECKS[check.check_type as CheckTypes];
  if (!Renderer) return null;

  return <Renderer check={check} />;
}

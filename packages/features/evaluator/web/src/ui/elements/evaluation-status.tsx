import { CheckCircle, Clock, MinusCircle, XCircle } from "react-feather";
import type { ElasticSearchEvaluation } from "@langwatch/trace-contract";
import { evaluationPassed, type EvaluationVerdictReading } from "../../model/evaluation-status";

export function CheckStatusIcon({ check }: { check: EvaluationVerdictReading }) {
  const iconMap: Record<ElasticSearchEvaluation["status"], React.FC> = {
    scheduled: Clock,
    in_progress: Clock,
    error: XCircle, // CloseIcon?
    skipped: MinusCircle,
    processed: evaluationPassed(check) === false ? XCircle : CheckCircle,
  };

  const Icon = iconMap[check.status] || Clock;

  return <Icon />;
}

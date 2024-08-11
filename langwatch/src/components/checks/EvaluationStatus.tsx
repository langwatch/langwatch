import { CheckCircle, Clock, MinusCircle, XCircle } from "react-feather";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";

export function CheckStatusIcon({ check }: { check: ElasticSearchEvaluation }) {
  const iconMap: Record<ElasticSearchEvaluation["status"], React.FC> = {
    scheduled: Clock,
    in_progress: Clock,
    error: XCircle, // CloseIcon?
    skipped: MinusCircle,
    processed: check.passed === false ? XCircle : CheckCircle,
  };

  const Icon = iconMap[check.status];

  return <Icon />;
}

export const checkStatusColorMap = (check: {
  status: ElasticSearchEvaluation["status"];
  passed?: boolean;
}) => {
  const colorMap: Record<ElasticSearchEvaluation["status"], string> = {
    scheduled: "yellow.600",
    in_progress: "yellow.600",
    error: "red.800",
    skipped: "yellow.600",
    processed: check.passed === false ? "red.600" : "green.600",
  };

  return colorMap[check.status];
};

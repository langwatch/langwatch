import { CheckCircle, Clock, MinusCircle, XCircle } from "react-feather";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";

export function CheckStatusIcon({
  check,
}: {
  check: Pick<ElasticSearchEvaluation, "status" | "passed" | "score">;
}) {
  const iconMap: Record<ElasticSearchEvaluation["status"], React.FC> = {
    scheduled: Clock,
    in_progress: Clock,
    error: XCircle, // CloseIcon?
    skipped: MinusCircle,
    processed: evaluationPassed(check) === false ? XCircle : CheckCircle,
  };

  const Icon = iconMap[check.status];

  return <Icon />;
}

export const checkStatusColorMap = (
  check: Pick<ElasticSearchEvaluation, "status" | "passed" | "score">
) => {
  const colorMap: Record<ElasticSearchEvaluation["status"], string> = {
    scheduled: "yellow.600",
    in_progress: "yellow.600",
    error: "red.800",
    skipped: "yellow.600",
    processed: evaluationPassed(check) === false ? "red.600" : "green.600",
  };

  return colorMap[check.status];
};

export const evaluationPassed = (
  evaluation: Pick<ElasticSearchEvaluation, "status" | "passed" | "score">
) => {
  if (evaluation.status !== "processed") {
    return undefined;
  }

  return (
    evaluation.passed !== false &&
    (!!evaluation.passed || evaluation.score != 0)
  );
};

import { CheckCircle, Clock, MinusCircle, XCircle } from "react-feather";
import type { TraceCheck } from "../../server/tracer/types";

export function CheckStatusIcon({ check }: { check: TraceCheck }) {
  const iconMap: Record<TraceCheck["status"], React.FC> = {
    scheduled: Clock,
    in_progress: Clock,
    error: XCircle, // CloseIcon?
    skipped: MinusCircle,
    processed: check.passed === false ? XCircle : CheckCircle,
  };

  const Icon = iconMap[check.status];

  return <Icon />;
}

export const checkStatusColorMap = (check: TraceCheck) => {
  const colorMap: Record<TraceCheck["status"], string> = {
    scheduled: "yellow.600",
    in_progress: "yellow.600",
    error: "red.800",
    skipped: "yellow.600",
    processed: check.passed === false ? "red.600" : "green.600",
  };

  return colorMap[check.status];
};

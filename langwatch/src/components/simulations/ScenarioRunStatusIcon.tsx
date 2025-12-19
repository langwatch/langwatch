import { AlertCircle, Check, Clock, X } from "react-feather";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";

interface ScenarioRunStatusIconProps {
  status?: ScenarioRunStatus;
  size?: number;
}

export function ScenarioRunStatusIcon({
  status,
  size = 12,
}: ScenarioRunStatusIconProps) {
  if (status === ScenarioRunStatus.SUCCESS) {
    return <Check size={size} color="green" />;
  }

  if (
    status === ScenarioRunStatus.FAILED ||
    status === ScenarioRunStatus.ERROR
  ) {
    return <X size={size} color="red" />;
  }

  if (status === ScenarioRunStatus.CANCELLED) {
    return <AlertCircle size={size} color="gray" />;
  }

  if (
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING
  ) {
    return <Clock size={size} color={status === ScenarioRunStatus.IN_PROGRESS ? "orange" : "gray"} />;
  }

  // Default fallback for undefined or unknown status
  return <Clock size={size} color="gray" />;
}

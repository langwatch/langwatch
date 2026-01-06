import { Icon, type IconProps } from "@chakra-ui/react";
import { Check, Clock, XCircle } from "lucide-react";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";

interface ScenarioRunStatusIconProps extends Omit<IconProps, "as" | "color"> {
  status?: ScenarioRunStatus;
  color?: string;
}

export function ScenarioRunStatusIcon({
  status,
  color,
  boxSize,
  ...iconProps
}: ScenarioRunStatusIconProps) {
  let IconComponent = Clock;
  let defaultColor = "green.400";
  let defaultBoxSize = "16px";

  if (status === ScenarioRunStatus.SUCCESS) {
    IconComponent = Check;
    defaultColor = "green.400";
  } else if (
    status === ScenarioRunStatus.FAILED ||
    status === ScenarioRunStatus.ERROR
  ) {
    IconComponent = XCircle;
    defaultColor = "red.400";
  } else if (
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING
  ) {
    IconComponent = Clock;
    defaultColor =
      status === ScenarioRunStatus.IN_PROGRESS ? "orange.400" : "gray.400";
  }

  return (
    <Icon
      as={IconComponent}
      color={color ?? defaultColor}
      boxSize={boxSize ?? defaultBoxSize}
      {...iconProps}
    />
  );
}

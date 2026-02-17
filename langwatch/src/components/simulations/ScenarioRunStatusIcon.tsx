import { Icon, type IconProps } from "@chakra-ui/react";
import { Check, Clock, XCircle } from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

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
  let defaultColor = "green.fg";
  let defaultBoxSize = "16px";

  if (status === ScenarioRunStatus.SUCCESS) {
    IconComponent = Check;
    defaultColor = "green.fg";
  } else if (
    status === ScenarioRunStatus.FAILED ||
    status === ScenarioRunStatus.ERROR
  ) {
    IconComponent = XCircle;
    defaultColor = "red.fg";
  } else if (
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING
  ) {
    IconComponent = Clock;
    defaultColor =
      status === ScenarioRunStatus.IN_PROGRESS ? "orange.fg" : "fg.muted";
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

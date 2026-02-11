import { Icon, type IconProps } from "@chakra-ui/react";
import { AlertTriangle, Check, Clock, XCircle } from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

interface ScenarioRunStatusIconProps extends Omit<IconProps, "as" | "color"> {
  status?: ScenarioRunStatus;
  color?: string;
}

function getIconAndColor(status: ScenarioRunStatus | undefined): {
  icon: typeof Check;
  color: string;
} {
  if (status === undefined) {
    return { icon: Clock, color: "green.fg" };
  }

  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return { icon: Check, color: "green.fg" };
    case ScenarioRunStatus.FAILED:
    case ScenarioRunStatus.ERROR:
      return { icon: XCircle, color: "red.fg" };
    case ScenarioRunStatus.IN_PROGRESS:
      return { icon: Clock, color: "orange.fg" };
    case ScenarioRunStatus.PENDING:
      return { icon: Clock, color: "fg.muted" };
    case ScenarioRunStatus.CANCELLED:
      return { icon: XCircle, color: "fg.muted" };
    case ScenarioRunStatus.STALLED:
      return { icon: AlertTriangle, color: "yellow.fg" };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled ScenarioRunStatus: ${_exhaustive}`);
    }
  }
}

export function ScenarioRunStatusIcon({
  status,
  color,
  boxSize,
  ...iconProps
}: ScenarioRunStatusIconProps) {
  const { icon: IconComponent, color: defaultColor } = getIconAndColor(status);

  return (
    <Icon
      as={IconComponent}
      color={color ?? defaultColor}
      boxSize={boxSize ?? "16px"}
      {...iconProps}
    />
  );
}

import { Icon, type IconProps } from "@chakra-ui/react";
import {
  AlertTriangle,
  Check,
  Clock,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/server/scenarios/status-config";

interface ScenarioRunStatusIconProps extends Omit<IconProps, "as" | "color"> {
  status?: ScenarioRunStatus;
  color?: string;
}

const SCENARIO_RUN_STATUS_ICONS: Record<ScenarioRunStatus, LucideIcon> = {
  [ScenarioRunStatus.SUCCESS]: Check,
  [ScenarioRunStatus.FAILED]: XCircle,
  [ScenarioRunStatus.ERROR]: XCircle,
  [ScenarioRunStatus.CANCELLED]: XCircle,
  [ScenarioRunStatus.STALLED]: AlertTriangle,
  [ScenarioRunStatus.IN_PROGRESS]: Clock,
  [ScenarioRunStatus.PENDING]: Clock,
};

function getIconAndColor(status: ScenarioRunStatus | undefined): {
  icon: LucideIcon;
  color: string;
} {
  if (status === undefined) {
    return { icon: Clock, color: "green.fg" };
  }

  return {
    icon: SCENARIO_RUN_STATUS_ICONS[status],
    color: SCENARIO_RUN_STATUS_CONFIG[status].fgColor,
  };
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

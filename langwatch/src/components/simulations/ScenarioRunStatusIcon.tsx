import { Icon, type IconProps } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  SCENARIO_RUN_STATUS_CONFIG,
  SCENARIO_RUN_STATUS_ICONS,
} from "./scenario-run-status-config";

interface ScenarioRunStatusIconProps extends Omit<IconProps, "as" | "color"> {
  status?: ScenarioRunStatus;
  color?: string;
}

export function getIconAndColor(status: ScenarioRunStatus | undefined): {
  icon: LucideIcon;
  color: string;
} {
  if (status === undefined) {
    return {
      icon: SCENARIO_RUN_STATUS_ICONS[ScenarioRunStatus.PENDING],
      color: "green.fg",
    };
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

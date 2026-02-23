import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  Clock,
  Loader,
  XCircle,
} from "lucide-react";
import { ScenarioRunStatus } from "./scenario-event.enums";

export interface StatusConfig {
  /** Chakra colorPalette token */
  colorPalette: string;
  /** Human-readable label for badges */
  label: string;
  /** Whether the run is in a terminal state */
  isComplete: boolean;
  /** Chakra semantic color token for icon/text */
  fgColor: string;
  /** Lucide icon component for this status */
  icon: LucideIcon;
  /** Whether the icon should animate (spin) */
  animate: boolean;
}

export const SCENARIO_RUN_STATUS_CONFIG: Record<
  ScenarioRunStatus,
  StatusConfig
> = {
  [ScenarioRunStatus.SUCCESS]: {
    colorPalette: "green",
    label: "completed",
    isComplete: true,
    fgColor: "green.fg",
    icon: CheckCircle,
    animate: false,
  },
  [ScenarioRunStatus.FAILED]: {
    colorPalette: "red",
    label: "failed",
    isComplete: true,
    fgColor: "red.fg",
    icon: XCircle,
    animate: false,
  },
  [ScenarioRunStatus.ERROR]: {
    colorPalette: "red",
    label: "failed",
    isComplete: true,
    fgColor: "red.fg",
    icon: XCircle,
    animate: false,
  },
  [ScenarioRunStatus.CANCELLED]: {
    colorPalette: "gray",
    label: "cancelled",
    isComplete: true,
    fgColor: "fg.muted",
    icon: Ban,
    animate: false,
  },
  [ScenarioRunStatus.STALLED]: {
    colorPalette: "yellow",
    label: "stalled",
    isComplete: true,
    fgColor: "yellow.fg",
    icon: AlertTriangle,
    animate: false,
  },
  [ScenarioRunStatus.IN_PROGRESS]: {
    colorPalette: "orange",
    label: "running",
    isComplete: false,
    fgColor: "orange.fg",
    icon: Loader,
    animate: true,
  },
  [ScenarioRunStatus.PENDING]: {
    colorPalette: "gray",
    label: "pending",
    isComplete: false,
    fgColor: "fg.muted",
    icon: Clock,
    animate: false,
  },
};

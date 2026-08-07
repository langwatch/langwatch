import {
  AlertTriangle,
  Check,
  Clock,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

export interface ScenarioRunStatusConfig {
  /** Chakra colorPalette token */
  colorPalette: string;
  /** Human-readable label for badges */
  label: string;
  /** Whether the run is in a terminal state */
  isComplete: boolean;
  /** Chakra semantic color token for icon/text */
  fgColor: string;
}

export const SCENARIO_RUN_STATUS_CONFIG: Record<
  ScenarioRunStatus,
  ScenarioRunStatusConfig
> = {
  [ScenarioRunStatus.SUCCESS]: {
    colorPalette: "green",
    label: "completed",
    isComplete: true,
    fgColor: "green.solid",
  },
  [ScenarioRunStatus.FAILED]: {
    colorPalette: "red",
    label: "failed",
    isComplete: true,
    fgColor: "red.solid",
  },
  [ScenarioRunStatus.ERROR]: {
    colorPalette: "red",
    label: "failed",
    isComplete: true,
    fgColor: "red.solid",
  },
  [ScenarioRunStatus.CANCELLED]: {
    colorPalette: "gray",
    label: "cancelled",
    isComplete: true,
    fgColor: "fg.muted",
  },
  [ScenarioRunStatus.STALLED]: {
    colorPalette: "yellow",
    label: "stalled",
    isComplete: true,
    fgColor: "yellow.solid",
  },
  [ScenarioRunStatus.IN_PROGRESS]: {
    colorPalette: "orange",
    label: "running",
    isComplete: false,
    fgColor: "orange.fg",
  },
  [ScenarioRunStatus.PENDING]: {
    colorPalette: "gray",
    label: "pending",
    isComplete: false,
    fgColor: "fg.muted",
  },
  [ScenarioRunStatus.QUEUED]: {
    colorPalette: "blue",
    label: "queued",
    isComplete: false,
    fgColor: "blue.fg",
  },
  [ScenarioRunStatus.RUNNING]: {
    colorPalette: "orange",
    label: "running",
    isComplete: false,
    fgColor: "orange.fg",
  },
};

export const SCENARIO_RUN_STATUS_ICONS: Record<ScenarioRunStatus, LucideIcon> =
  {
    [ScenarioRunStatus.SUCCESS]: Check,
    [ScenarioRunStatus.FAILED]: XCircle,
    [ScenarioRunStatus.ERROR]: XCircle,
    [ScenarioRunStatus.CANCELLED]: XCircle,
    [ScenarioRunStatus.STALLED]: AlertTriangle,
    [ScenarioRunStatus.IN_PROGRESS]: Clock,
    [ScenarioRunStatus.PENDING]: Clock,
    [ScenarioRunStatus.QUEUED]: Clock,
    [ScenarioRunStatus.RUNNING]: Clock,
  };

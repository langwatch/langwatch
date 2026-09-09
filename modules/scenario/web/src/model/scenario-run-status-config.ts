import { AlertTriangle, Check, Clock, type LucideIcon, XCircle } from "lucide-react";
import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";

export interface ScenarioRunStatusConfig {
  colorPalette: string;
  label: string;
  isComplete: boolean;
  fgColor: string;
}

/**
 * What every status of a scenario run reads as, everywhere it is drawn.
 */
export const SCENARIO_RUN_STATUS_CONFIG: Record<ScenarioRunStatus, ScenarioRunStatusConfig> = {
  [ScenarioRunStatus.SUCCESS]: {
    colorPalette: "green",
    label: "completed",
    isComplete: true,
    fgColor: "green.500",
  },
  [ScenarioRunStatus.FAILED]: {
    colorPalette: "red",
    label: "failed",
    isComplete: true,
    fgColor: "red.500",
  },
  [ScenarioRunStatus.ERROR]: {
    colorPalette: "red",
    label: "failed",
    isComplete: true,
    fgColor: "red.500",
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
    fgColor: "yellow.500",
  },
  [ScenarioRunStatus.IN_PROGRESS]: {
    colorPalette: "blue",
    label: "running",
    isComplete: false,
    fgColor: "blue.fg",
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
    colorPalette: "blue",
    label: "running",
    isComplete: false,
    fgColor: "blue.fg",
  },
};

export const SCENARIO_RUN_STATUS_ICONS: Record<ScenarioRunStatus, LucideIcon> = {
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

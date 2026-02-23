/**
 * Client-side icon mappings for scenario run statuses.
 *
 * Extends the server-safe StatusConfig with Lucide icon components
 * and animation flags for use in React components.
 */

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  Clock,
  Loader,
  XCircle,
} from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

export interface StatusIconConfig {
  icon: LucideIcon;
  animate: boolean;
}

export const STATUS_ICON_CONFIG: Record<ScenarioRunStatus, StatusIconConfig> = {
  [ScenarioRunStatus.SUCCESS]: { icon: CheckCircle, animate: false },
  [ScenarioRunStatus.FAILED]: { icon: XCircle, animate: false },
  [ScenarioRunStatus.ERROR]: { icon: XCircle, animate: false },
  [ScenarioRunStatus.CANCELLED]: { icon: Ban, animate: false },
  [ScenarioRunStatus.STALLED]: { icon: AlertTriangle, animate: false },
  [ScenarioRunStatus.IN_PROGRESS]: { icon: Loader, animate: true },
  [ScenarioRunStatus.PENDING]: { icon: Clock, animate: false },
};

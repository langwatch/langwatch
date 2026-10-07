/**
 * The ops.upgrade reads' answers, in ops' own contract shapes, named the way the sections read
 * them. Nothing here restates a shape.
 */
import type {
  OpsUpgradeRelease,
  OpsUpgradeRun,
  OpsUpgradeRunPhase,
  OpsUpgradeRunSummary,
  OpsUpgradeStatus,
  OpsUpgradeStep,
  OpsUpgradeStepDetail,
  OpsUpgradeTarget,
} from "@langwatch/ops-contract";

export type UpgradeRunSummaryView = OpsUpgradeRunSummary;
/** One phase of a run's report (round 9, U2-PHASES); an unknown name or outcome reads raw. */
export type UpgradeRunPhaseView = OpsUpgradeRunPhase;
/** `state` includes `never-upgraded` (round 17, U1-a), labelled "Never upgraded" by the reader. */
export type UpgradeStatusView = OpsUpgradeStatus;
export type UpgradeReleaseView = OpsUpgradeRelease;
export type UpgradeStepView = OpsUpgradeStep;
export type UpgradeTargetView = OpsUpgradeTarget;
export type UpgradeStepDetailView = OpsUpgradeStepDetail;
export type UpgradeRunDetailView = OpsUpgradeRun;

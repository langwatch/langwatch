import { INSTALLATION_STATES } from "./labels.ts";
import type { InstallationReason, InstallationState } from "./reader.schema.ts";
import { compareReleases } from "./release.ts";

export interface InstallationFacts {
  imageRelease: string;
  imageSteps: readonly { id: string; mode: string }[];
  floor: string | null;
  installed: string | null;
  ledgerFloor: string | null;
  ledgerHoldsRecords: boolean;
  steps: readonly { id: string; status: string }[];
  failedTargets: number;
  holdsLease: boolean;
}

export interface InstallationVerdict {
  state: InstallationState;
  reason: InstallationReason;
  summary: string;
}

const SETTLED = new Set(["done", "not-needed"]);

function plural({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${count} ${count === 1 ? one : many}`;
}

function checkUnsupported(facts: InstallationFacts): InstallationVerdict | null {
  const { imageRelease, installed, floor, ledgerFloor } = facts;
  if (floor && installed && compareReleases({ left: installed, right: floor }) === "older") {
    return {
      state: "unsupported",
      reason: "installed-below-floor",
      summary: `Installed release ${installed} is below the supported floor ${floor}. Upgrade to ${floor} first.`,
    };
  }
  if (ledgerFloor && compareReleases({ left: imageRelease, right: ledgerFloor }) === "older") {
    return {
      state: "unsupported",
      reason: "image-below-ledger-floor",
      summary: `This image (${imageRelease}) is older than the floor ${ledgerFloor} this installation was upgraded with.`,
    };
  }
  return null;
}

function checkNeedsAttention(facts: InstallationFacts): InstallationVerdict | null {
  const failedSteps = facts.steps.filter((step) => step.status === "failed").length;
  if (failedSteps > 0) {
    const count = plural({ count: failedSteps, one: "step", many: "steps" });
    return { state: "needs-attention", reason: "failed-step", summary: `${count} failed.` };
  }
  if (facts.failedTargets > 0) {
    const count = plural({ count: facts.failedTargets, one: "target", many: "targets" });
    return { state: "needs-attention", reason: "failed-target", summary: `${count} failed.` };
  }
  return null;
}

function checkUpgrading(facts: InstallationFacts): InstallationVerdict | null {
  if (!facts.holdsLease) return null;
  return { state: "upgrading", reason: "run-in-progress", summary: "An upgrade is running." };
}

function checkBehind(facts: InstallationFacts): InstallationVerdict | null {
  const { imageRelease, installed } = facts;
  if (!facts.ledgerHoldsRecords) {
    return {
      state: "behind",
      reason: "no-upgrade-recorded",
      summary: "No upgrade recorded yet. Run the upgrade before this image serves.",
    };
  }
  if (installed && compareReleases({ left: imageRelease, right: installed }) === "newer") {
    return {
      state: "behind",
      reason: "image-newer",
      summary: `Image ${imageRelease} is newer than the installed ${installed}. Run the upgrade.`,
    };
  }
  const statusById = new Map(facts.steps.map((step) => [step.id, step.status]));
  const unsettled = facts.imageSteps.filter(
    (step) => step.mode === "blocking" && !SETTLED.has(statusById.get(step.id) ?? ""),
  ).length;
  if (unsettled === 0) return null;
  const count = plural({ count: unsettled, one: "blocking step", many: "blocking steps" });
  return {
    state: "behind",
    reason: "blocking-steps-pending",
    summary: `${count} this image declares not completed. Run the upgrade.`,
  };
}

function checkRolledBack(facts: InstallationFacts): InstallationVerdict | null {
  const { imageRelease, installed } = facts;
  if (!installed || compareReleases({ left: imageRelease, right: installed }) !== "older") {
    return null;
  }
  return {
    state: "rolled-back",
    reason: "image-older",
    summary: `Image ${imageRelease} is older than the installed ${installed}.`,
  };
}

function checkFinishing(facts: InstallationFacts): InstallationVerdict | null {
  const waiting = facts.steps.filter(
    (step) => step.status === "pending" || step.status === "running",
  ).length;
  if (waiting === 0) return null;
  const count = plural({ count: waiting, one: "step", many: "steps" });
  return {
    state: "finishing-in-background",
    reason: "background-pending",
    summary: `${count} still waiting or running in the background.`,
  };
}

/**
 * The installation state of the UI plan's section 4. The first match wins, in the order of
 * `INSTALLATION_STATES`: Unsupported, Needs attention, Upgrading, Behind, Rolled back, Finishing
 * in background, Up to date. Pure: it is handed the ledger's facts and looks nothing up.
 */
export function computeInstallationState(facts: InstallationFacts): InstallationVerdict {
  return (
    checkUnsupported(facts) ??
    checkNeedsAttention(facts) ??
    checkUpgrading(facts) ??
    checkBehind(facts) ??
    checkRolledBack(facts) ??
    checkFinishing(facts) ?? {
      state: "up-to-date",
      reason: "current",
      summary: `Release ${facts.installed ?? facts.imageRelease} is current.`,
    }
  );
}

export function describeInstallationState({ state }: { state: InstallationState }) {
  return INSTALLATION_STATES[state];
}

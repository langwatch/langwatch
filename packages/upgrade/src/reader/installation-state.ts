import { INSTALLATION_STATES } from "./labels.ts";
import type { InstallationReason, InstallationState } from "./reader.schema.ts";
import { orderReleases } from "./release.ts";
import { UNRELEASED_IMAGE } from "./step-view.ts";

export interface InstallationFacts {
  imageRelease: string;
  /** How a summary names the image: its release, or "Development build <release>+<commit>". */
  imageName?: string;
  imageSteps: readonly { id: string; mode: string }[];
  installed: string | null;
  ledgerHoldsRecords: boolean;
  steps: readonly { id: string; status: string }[];
  failedTargets: number;
  holdsLease: boolean;
  /** The newest run ended failed: a reconciler can fail after every step settled. */
  lastRunFailed: boolean;
}

export interface InstallationVerdict {
  state: InstallationState;
  reason: InstallationReason;
  summary: string;
}

const SETTLED = new Set(["done", "not-needed"]);

/** The image's name in a summary; never the internal "unreleased" (UPGRADE-UI-2). */
export function imageNameOf({ imageRelease, imageName }: InstallationFacts): string {
  return imageName ?? (imageRelease === UNRELEASED_IMAGE ? "Development build" : imageRelease);
}

function plural({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${count} ${count === 1 ? one : many}`;
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
  if (facts.lastRunFailed) {
    return {
      state: "needs-attention",
      reason: "failed-run",
      summary: "The last upgrade run failed.",
    };
  }
  return null;
}

function checkUpgrading(facts: InstallationFacts): InstallationVerdict | null {
  if (!facts.holdsLease) return null;
  return { state: "upgrading", reason: "run-in-progress", summary: "An upgrade is running." };
}

/** Round 17 (U1-a): an empty ledger is its own state, not Behind with a reason. */
function checkNeverUpgraded(facts: InstallationFacts): InstallationVerdict | null {
  if (facts.ledgerHoldsRecords) return null;
  return {
    state: "never-upgraded",
    reason: "no-upgrade-recorded",
    summary: "No upgrade recorded yet.",
  };
}

function checkBehind(facts: InstallationFacts): InstallationVerdict | null {
  const { imageRelease, installed } = facts;
  if (installed && orderReleases({ left: imageRelease, right: installed }) === "newer") {
    return {
      state: "behind",
      reason: "image-newer",
      summary: `Image ${imageNameOf(facts)} is newer than the installed ${installed}.`,
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
    summary: `${count} this image declares not completed.`,
  };
}

function checkRolledBack(facts: InstallationFacts): InstallationVerdict | null {
  const { imageRelease, installed } = facts;
  if (!installed || orderReleases({ left: imageRelease, right: installed }) !== "older") {
    return null;
  }
  return {
    state: "rolled-back",
    reason: "image-older",
    summary: `Image ${imageNameOf(facts)} is older than the installed ${installed}.`,
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
 * `INSTALLATION_STATES`: Needs attention, Upgrading, Never upgraded, Behind, Rolled
 * back, Finishing in background, Up to date. Pure: it is handed the ledger's facts.
 */
export function computeInstallationState(facts: InstallationFacts): InstallationVerdict {
  return (
    checkNeedsAttention(facts) ??
    checkUpgrading(facts) ??
    checkNeverUpgraded(facts) ??
    checkBehind(facts) ??
    checkRolledBack(facts) ??
    checkFinishing(facts) ?? {
      state: "up-to-date",
      reason: "current",
      summary: `${installedName(facts)} is current.`,
    }
  );
}

/** The installed release, or the image's name when it installed past every release. */
function installedName(facts: InstallationFacts): string {
  const { installed } = facts;
  return installed && installed !== UNRELEASED_IMAGE ? installed : imageNameOf(facts);
}

export function describeInstallationState({ state }: { state: InstallationState }) {
  return INSTALLATION_STATES[state];
}

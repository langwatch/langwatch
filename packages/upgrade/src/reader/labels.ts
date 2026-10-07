import type { InstallationState, InstallationTone } from "./reader.schema.ts";

/** The installation states of the UI plan's section 4, in the order the first match wins. */
export const INSTALLATION_STATES: Readonly<
  Record<InstallationState, { label: string; tone: InstallationTone }>
> = {
  unsupported: { label: "Unsupported", tone: "danger" },
  "needs-attention": { label: "Needs attention", tone: "danger" },
  upgrading: { label: "Upgrading", tone: "info" },
  "never-upgraded": { label: "Never upgraded", tone: "warning" },
  behind: { label: "Behind", tone: "warning" },
  "rolled-back": { label: "Rolled back", tone: "warning" },
  "finishing-in-background": { label: "Finishing in background", tone: "info" },
  "up-to-date": { label: "Up to date", tone: "neutral" },
};

const STEP_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "Waiting",
  running: "Running",
  done: "Done",
  "not-needed": "Not needed (fresh install)",
  failed: "Failed",
  gated: "Not enabled here",
};

/** A status the ledger's runner knows reads as its label; any other reads exactly as stored. */
export function describeStepStatus({ status }: { status: string }): string {
  return STEP_STATUS_LABELS[status] ?? status;
}

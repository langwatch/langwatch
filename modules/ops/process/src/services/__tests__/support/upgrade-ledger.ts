import type { UpgradeReader, UpgradeStatus, UpgradeStepView } from "@langwatch/upgrade/reader";

/** One ledger step as the reader views it: a done blocking Postgres step unless overridden. */
export function stepOf(
  overrides: Partial<UpgradeStepView> & Pick<UpgradeStepView, "id">,
): UpgradeStepView {
  return {
    kind: "postgres-schema",
    release: "3.21.0",
    mode: "blocking",
    status: "done",
    statusLabel: "Done",
    owner: null,
    description: null,
    finishBy: null,
    recorded: true,
    inferred: false,
    attempt: 1,
    lastError: null,
    report: null,
    progress: null,
    waitingOn: [],
    runId: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

export function statusOf(overrides: Partial<UpgradeStatus> = {}): UpgradeStatus {
  return {
    state: "up-to-date",
    label: "Up to date",
    tone: "neutral",
    reason: "current",
    summary: "Every blocking step is done.",
    installed: "3.21.0",
    origin: "recorded",
    image: "3.21.0",
    floor: "3.20.1",
    ledgerFloor: "3.20.1",
    lease: null,
    lastRun: null,
    counts: {},
    failedStepIds: [],
    failedTargets: 0,
    ...overrides,
  };
}

/** An upgrade ledger holding these steps, as `upgrade status` would read it. */
export function ledgerOf(
  steps: UpgradeStepView[],
  status: UpgradeStatus = statusOf(),
): Pick<UpgradeReader, "status" | "listSteps"> {
  return {
    status: async () => status,
    listSteps: async (filter) => ({
      items: steps.filter((step) => !filter?.mode || step.mode === filter.mode),
      cursor: null,
    }),
  };
}

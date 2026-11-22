// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UpgradeDiagnosticsSubmission } from "@langwatch/enterprise-licensing-contract";

/** One failed background step's submission, as an install's hourly check sends it. */
export function upgradeDiagnosticsSubmission(
  step: Partial<UpgradeDiagnosticsSubmission["bundle"]["step"]> = {},
  trigger: UpgradeDiagnosticsSubmission["trigger"] = "automatic",
): UpgradeDiagnosticsSubmission {
  return {
    trigger,
    bundle: {
      format: 1,
      generatedAt: "2026-10-20T10:00:00Z",
      step: {
        id: "trace:backfill-span-costs",
        kind: "data",
        mode: "background",
        description: "Fills the cost of every span stored before costs were recorded.",
        release: "3.23.0",
        status: "failed",
        attempt: 1,
        startedAt: "2026-10-20T09:00:00Z",
        finishedAt: "2026-10-20T09:05:00Z",
        updatedAt: "2026-10-20T09:05:00Z",
        lastError: 'relation "spans" does not exist',
        report: { processed: 10 },
        logTail: ["started", 'relation "spans" does not exist'],
        ...step,
      },
      targets: [],
      deployment: {
        imageRelease: "3.23.0",
        chartVersion: "3.0.0",
        installMethod: "helm",
        instanceId: "install-1",
      },
      omitted: [],
    },
  };
}

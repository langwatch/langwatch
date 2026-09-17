/**
 * Shared hook wrapping `api.suites.run.useMutation` with archived-toast logic.
 *
 * Used by both SuiteFormDrawer (Save & Run) and suites/index.tsx (sidebar Run).
 */

import { api } from "../scenario-api.ts";
import { toaster } from "@langwatch/design-system/toaster";
import { showSuiteRunError } from "./show-suite-run-error.ts";

interface UseSuiteRunMutationOptions {
  onEditSuite: (suiteId: string) => void;
  onSuccess?: () => void;
}

function showScheduledRun({
  jobCount,
  skippedArchived,
  suiteId,
  onEditSuite,
}: {
  jobCount: number;
  skippedArchived: { scenarios: unknown[]; targets: unknown[] };
  suiteId: string;
  onEditSuite: (suiteId: string) => void;
}): void {
  const archivedCount = skippedArchived.scenarios.length + skippedArchived.targets.length;
  if (archivedCount === 0) {
    toaster.create({
      title: `Run scheduled (${jobCount} jobs)`,
      type: "success",
    });
    return;
  }

  const parts: string[] = [];
  if (skippedArchived.scenarios.length > 0) {
    parts.push(
      `${skippedArchived.scenarios.length} archived scenario${skippedArchived.scenarios.length > 1 ? "s" : ""}`,
    );
  }
  if (skippedArchived.targets.length > 0) {
    parts.push(
      `${skippedArchived.targets.length} archived target${skippedArchived.targets.length > 1 ? "s" : ""}`,
    );
  }

  toaster.create({
    title: `Run scheduled (${jobCount} jobs)`,
    description: `${parts.join(" and ")} skipped.`,
    type: "warning",
    action: {
      label: "Edit Run Plan",
      onClick: () => onEditSuite(suiteId),
    },
  });
}

export function useSuiteRunMutation({ onEditSuite, onSuccess }: UseSuiteRunMutationOptions) {
  const runMutation = api.suites.run.useMutation({
    onSuccess: (result, variables) => {
      onSuccess?.();

      showScheduledRun({
        jobCount: result.jobCount,
        skippedArchived: result.skippedArchived,
        suiteId: variables.id,
        onEditSuite,
      });
    },
    onError: (err, variables) => {
      showSuiteRunError({
        error: err,
        fallbackTitle: "Couldn't execute run plan",
        onEditRunPlan: () => onEditSuite(variables.id),
      });
    },
  });

  return { runMutation, isRunning: runMutation.isPending };
}

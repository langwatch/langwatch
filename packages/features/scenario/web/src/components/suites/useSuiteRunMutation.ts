/**
 * Shared hook wrapping `api.suites.run.useMutation` with archived-toast logic.
 *
 * Used by both SuiteFormDrawer (Save & Run) and suites/index.tsx (sidebar Run).
 */

import { api } from "../../behavior/scenario-api";
import { toaster } from "@langwatch/design-system/toaster";
import { showSuiteRunError } from "./showSuiteRunError";

interface UseSuiteRunMutationOptions {
  onEditSuite: (suiteId: string) => void;
  onSuccess?: () => void;
}

export function useSuiteRunMutation({
  onEditSuite,
  onSuccess,
}: UseSuiteRunMutationOptions) {
  const runMutation = api.suites.run.useMutation({
    onSuccess: (result, variables) => {
      onSuccess?.();

      const archivedCount =
        (result.skippedArchived?.scenarios?.length ?? 0) +
        (result.skippedArchived?.targets?.length ?? 0);

      if (archivedCount > 0) {
        const parts: string[] = [];
        if (result.skippedArchived.scenarios.length > 0) {
          parts.push(
            `${result.skippedArchived.scenarios.length} archived scenario${result.skippedArchived.scenarios.length > 1 ? "s" : ""}`,
          );
        }
        if (result.skippedArchived.targets.length > 0) {
          parts.push(
            `${result.skippedArchived.targets.length} archived target${result.skippedArchived.targets.length > 1 ? "s" : ""}`,
          );
        }

        toaster.create({
          title: `Run scheduled (${result.jobCount} jobs)`,
          description: `${parts.join(" and ")} skipped.`,
          type: "warning",
          action: {
            label: "Edit Run Plan",
            onClick: () => onEditSuite(variables.id),
          },
        });
      } else {
        toaster.create({
          title: `Run scheduled (${result.jobCount} jobs)`,
          type: "success",
        });
      }
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

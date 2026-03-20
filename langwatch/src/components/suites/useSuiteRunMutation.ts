/**
 * Shared hook wrapping `api.suites.run.useMutation` with archived-toast logic.
 *
 * Used by both SuiteFormDrawer (Save & Run) and suites/index.tsx (sidebar Run).
 */

import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";

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
          meta: { closable: true },
          action: {
            label: "Edit Run Plan",
            onClick: () => onEditSuite(variables.id),
          },
        });
      } else {
        toaster.create({
          title: `Run scheduled (${result.jobCount} jobs)`,
          type: "success",
          meta: { closable: true },
        });
      }
    },
    onError: (err, variables) => {
      const isAllArchived =
        err.data?.code === "BAD_REQUEST" &&
        (err.message.includes("All scenarios") ||
          err.message.includes("All targets"));

      toaster.create({
        title: isAllArchived ? "Cannot execute run plan" : "Failed to execute run plan",
        description: err.message,
        type: "error",
        meta: { closable: true },
        ...(isAllArchived
          ? {
              action: {
                label: "Edit Run Plan",
                onClick: () => onEditSuite(variables.id),
              },
            }
          : {}),
      });
    },
  });

  return { runMutation, isRunning: runMutation.isPending };
}

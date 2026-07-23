/**
 * Shared hook wrapping `api.suites.run.useMutation` with archived-toast logic.
 *
 * Used by both SuiteFormDrawer (Save & Run) and suites/index.tsx (sidebar Run).
 */

import {
  explainHandledError,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
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
      // A run plan with nothing runnable left is a curated rejection with its
      // own way out — this toast adds the "Edit Run Plan" action, which is the
      // fix. Keyed off the stable code; the words stay in the registry, which
      // already owns copy for both of these.
      const handled = readHandledError(err);
      const allArchived =
        handled &&
        (handled.code === "suite_all_scenarios_archived" ||
          handled.code === "suite_all_targets_archived")
          ? handled
          : null;

      if (allArchived) {
        const { title, description } = explainHandledError(allArchived);
        toaster.create({
          title,
          description: description || undefined,
          type: "error",
          meta: { closable: true },
          action: {
            label: "Edit Run Plan",
            onClick: () => onEditSuite(variables.id),
          },
        });
        return;
      }

      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't execute run plan",
      });
    },
  });

  return { runMutation, isRunning: runMutation.isPending };
}

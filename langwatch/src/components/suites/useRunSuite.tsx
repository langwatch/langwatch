/**
 * Centralized hook for running a suite with confirmation dialog.
 *
 * Encapsulates: confirmation modal state, the run mutation,
 * and all success/error toast handling. Every UI trigger for
 * running a suite should go through this hook so the confirmation
 * dialog is always shown.
 */

import type { SimulationSuite } from "@prisma/client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { parseSuiteTargets } from "~/server/suites/types";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";
import { SuiteRunConfirmationDialog } from "./SuiteRunConfirmationDialog";

type UseRunSuiteOptions = {
  /** Called after a successful run is scheduled (e.g. to navigate). */
  onRunScheduled?: (suiteId: string) => void;
};

export function useRunSuite(options: UseRunSuiteOptions = {}) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useContext();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [pendingSuiteId, setPendingSuiteId] = useState<string | null>(null);
  const [pendingSuite, setPendingSuite] = useState<SimulationSuite | null>(
    null,
  );

  const runMutation = api.suites.run.useMutation({
    onSuccess: (result, variables) => {
      void utils.scenarios.getSuiteRunData.invalidate();
      setPendingSuiteId(null);
      setPendingSuite(null);

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

        const suiteIdForEdit = variables.id;
        toaster.create({
          title: `Suite run scheduled (${result.jobCount} jobs)`,
          description: `${parts.join(" and ")} skipped.`,
          type: "warning",
          meta: { closable: true },
          action: {
            label: "Edit Suite",
            onClick: () => {
              openDrawer("suiteEditor", {
                urlParams: { suiteId: suiteIdForEdit },
              });
            },
          },
        });
      } else {
        toaster.create({
          title: `Suite run scheduled (${result.jobCount} jobs)`,
          type: "success",
          meta: { closable: true },
        });
      }

      optionsRef.current.onRunScheduled?.(variables.id);
    },
    onError: (err, variables) => {
      setPendingSuiteId(null);
      setPendingSuite(null);

      const suiteIdForToast = variables.id;
      const isAllArchived =
        err.data?.code === "BAD_REQUEST" &&
        (err.message.includes("All scenarios") ||
          err.message.includes("All targets"));
      toaster.create({
        title: isAllArchived ? "Cannot run suite" : "Failed to run suite",
        description: err.message,
        type: "error",
        meta: { closable: true },
        ...(isAllArchived
          ? {
              action: {
                label: "Edit Suite",
                onClick: () => {
                  openDrawer("suiteEditor", {
                    urlParams: { suiteId: suiteIdForToast },
                  });
                },
              },
            }
          : {}),
      });
    },
  });

  /** Open the confirmation dialog for a suite. */
  const requestRun = useCallback(
    (suite: SimulationSuite) => {
      if (!project || runMutation.isPending) return;
      setPendingSuiteId(suite.id);
      setPendingSuite(suite);
    },
    [project, runMutation.isPending],
  );

  /** Execute the run after user confirms. */
  const confirmRun = useCallback(() => {
    if (!project || !pendingSuiteId || runMutation.isPending) return;
    runMutation.mutate({ projectId: project.id, id: pendingSuiteId, idempotencyKey: crypto.randomUUID() });
  }, [project, pendingSuiteId, runMutation]);

  const closeConfirmation = useCallback(() => {
    if (runMutation.isPending) return;
    setPendingSuiteId(null);
    setPendingSuite(null);
  }, [runMutation.isPending]);

  const targetCount = useMemo(() => {
    if (!pendingSuite) return 0;
    return parseSuiteTargets(pendingSuite.targets).length;
  }, [pendingSuite]);

  /** Render this in the component tree to show the confirmation dialog. */
  const confirmationDialog = (
    <SuiteRunConfirmationDialog
      open={!!pendingSuiteId}
      onClose={closeConfirmation}
      onConfirm={confirmRun}
      suiteName={pendingSuite?.name ?? ""}
      scenarioCount={pendingSuite?.scenarioIds.length ?? 0}
      targetCount={targetCount}
      repeatCount={pendingSuite?.repeatCount ?? 1}
      isLoading={runMutation.isPending}
    />
  );

  return {
    requestRun,
    isPending: runMutation.isPending,
    confirmationDialog,
  };
}

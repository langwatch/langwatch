/**
 * Headless hook for running a suite with confirmation state management.
 *
 * Manages: confirmation dialog state, the run mutation, and toast handling.
 * The consumer is responsible for rendering the confirmation dialog using
 * the returned state props.
 */

import type { SimulationSuite } from "@prisma/client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { parseSuiteTargets } from "~/server/suites/types";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";

interface UseRunSuiteOptions {
  onRunScheduled?: (suiteId: string) => void;
}

export function useRunSuite(options: UseRunSuiteOptions = {}) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useContext();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [pendingSuite, setPendingSuite] = useState<SimulationSuite | null>(null);

  const runMutation = api.suites.run.useMutation({
    onSuccess: (result, variables) => {
      void utils.scenarios.getSuiteRunData.invalidate();
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

        toaster.create({
          title: `Run plan scheduled (${result.jobCount} jobs)`,
          description: `${parts.join(" and ")} skipped.`,
          type: "warning",
          meta: { closable: true },
          action: {
            label: "Edit Run Plan",
            onClick: () => {
              openDrawer("suiteEditor", {
                urlParams: { suiteId: variables.id },
              });
            },
          },
        });
      } else {
        toaster.create({
          title: `Run plan scheduled (${result.jobCount} jobs)`,
          type: "success",
          meta: { closable: true },
        });
      }

      optionsRef.current.onRunScheduled?.(variables.id);
    },
    onError: (err, variables) => {
      setPendingSuite(null);

      const isAllArchived =
        err.data?.code === "BAD_REQUEST" &&
        (err.message.includes("All scenarios") ||
          err.message.includes("All targets"));
      toaster.create({
        title: isAllArchived ? "Cannot start run plan" : "Run plan failed to start",
        description: err.message,
        type: "error",
        meta: { closable: true },
        ...(isAllArchived
          ? {
              action: {
                label: "Edit Run Plan",
                onClick: () => {
                  openDrawer("suiteEditor", {
                    urlParams: { suiteId: variables.id },
                  });
                },
              },
            }
          : {}),
      });
    },
  });

  const requestRun = useCallback(
    (suite: SimulationSuite) => {
      if (!project || runMutation.isPending) return;
      setPendingSuite(suite);
    },
    [project, runMutation.isPending],
  );

  const confirmRun = useCallback(() => {
    if (!project || !pendingSuite || runMutation.isPending) return;
    runMutation.mutate({
      projectId: project.id,
      id: pendingSuite.id,
      idempotencyKey: crypto.randomUUID(),
    });
  }, [project, pendingSuite, runMutation]);

  const cancelRun = useCallback(() => {
    if (runMutation.isPending) return;
    setPendingSuite(null);
  }, [runMutation.isPending]);

  const targetCount = useMemo(() => {
    if (!pendingSuite) return 0;
    return parseSuiteTargets(pendingSuite.targets).length;
  }, [pendingSuite]);

  return {
    requestRun,
    confirmRun,
    cancelRun,
    isPending: runMutation.isPending,
    /** Props to spread onto SuiteRunConfirmationDialog */
    dialogProps: {
      open: !!pendingSuite,
      onClose: cancelRun,
      onConfirm: confirmRun,
      suiteName: pendingSuite?.name ?? "",
      scenarioCount: pendingSuite?.scenarioIds.length ?? 0,
      targetCount,
      repeatCount: pendingSuite?.repeatCount ?? 1,
      isLoading: runMutation.isPending,
    },
  };
}

/**
 * What Settings, Checkup reads and what it can ask for.
 *
 * The page holds no verdict of its own: the free checks come with the status
 * query, and a row that costs egress or money keeps its "not run" verdict until
 * an administrator presses the band's button. The answer to that replaces the
 * row in place, which is what `explicitRows` holds.
 *
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { useState } from "react";
import { showErrorToast } from "~/features/errors";
import type { CheckGroup, CheckRow } from "~/server/checkup/verdict";
import { api } from "~/utils/api";

export function useCheckupScreen(organizationId: string) {
  const [explicitRows, setExplicitRows] = useState<Map<string, CheckRow>>(
    () => new Map(),
  );
  const [runPlanId, setRunPlanId] = useState("");
  const [runningGroup, setRunningGroup] = useState<CheckGroup | null>(null);

  const status = api.checkup.status.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const usageReport = api.checkup.usageReport.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const run = api.checkup.run.useMutation({
    onSuccess: (result, variables) => {
      if (result.deployment !== "self-hosted") return;
      const asked = new Set(variables.checks ?? []);
      setExplicitRows((current) => {
        const next = new Map(current);
        for (const row of result.rows) {
          if (asked.has(row.id)) next.set(row.id, row);
        }
        return next;
      });
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Couldn't run the checks" }),
    onSettled: () => setRunningGroup(null),
  });

  const setSwitches = api.checkup.setUsageReportSwitches.useMutation({
    onSuccess: () => void usageReport.refetch(),
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Couldn't change the report" }),
  });

  /** The rows as they stand, an explicitly run one in place of its original. */
  const rowsWith = (rows: readonly CheckRow[]): CheckRow[] =>
    rows.map((row) => explicitRows.get(row.id) ?? row);

  const runGroup = (group: CheckGroup, rows: readonly CheckRow[]) => {
    setRunningGroup(group);
    run.mutate({
      organizationId,
      checks: rows
        .filter((row) => row.group === group && row.cost !== "free")
        .map((row) => row.id),
      ...(group === "pipelines" && runPlanId.trim()
        ? { scenarioRunPlanId: runPlanId.trim() }
        : {}),
    });
  };

  return {
    status,
    usageReport,
    rowsWith,
    runGroup,
    runPlanId,
    setRunPlanId,
    isRunning: runningGroup !== null,
    isSavingSwitches: setSwitches.isPending,
    setSwitches,
  };
}

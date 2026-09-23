/**
 * What Settings, Checkup reads and asks for. A row that costs egress or money
 * keeps "not run" until an administrator runs its band; the answer replaces
 * it in place. Spec: specs/self-hosting/checkup/checkup.feature
 */
import type { CheckGroup, CheckRow } from "@langwatch/ops-contract";
import { useState } from "react";

import { useCheckupHost } from "../model/checkup-host.ts";
import { checkupApi } from "./checkup-api.ts";

export function useCheckupScreen(organizationId: string) {
  const host = useCheckupHost();
  const [explicitRows, setExplicitRows] = useState<Map<string, CheckRow>>(() => new Map());
  const [runPlanId, setRunPlanId] = useState("");
  const [runningGroup, setRunningGroup] = useState<CheckGroup | null>(null);

  const status = checkupApi.checkup.status.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const usageReport = checkupApi.checkup.usageReport.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const run = checkupApi.checkup.run.useMutation({
    onSuccess: (result, variables) => {
      if (result.deployment !== "self-hosted") return;
      const asked = new Set<string>(variables.checks ?? []);
      setExplicitRows((current) => {
        const next = new Map(current);
        for (const row of result.rows) {
          if (asked.has(row.id)) next.set(row.id, row);
        }
        return next;
      });
    },
    onError: (error: unknown) => host.failed({ error, fallbackTitle: "Couldn't run the checks" }),
    onSettled: () => setRunningGroup(null),
  });

  const setSwitches = checkupApi.checkup.setUsageReportSwitches.useMutation({
    onSuccess: () => void usageReport.refetch(),
    onError: (error: unknown) =>
      host.failed({ error, fallbackTitle: "Couldn't change the report" }),
  });

  /** The rows as they stand, an explicitly run one in place of its original. */
  const rowsWith = (rows: readonly CheckRow[]): CheckRow[] =>
    rows.map((row) => explicitRows.get(row.id) ?? row);

  const runGroup = (group: CheckGroup, rows: readonly CheckRow[]) => {
    setRunningGroup(group);
    run.mutate({
      organizationId,
      checks: rows.filter((row) => row.group === group && row.cost !== "free").map((row) => row.id),
      ...(group === "pipelines" && runPlanId.trim() ? { scenarioRunPlanId: runPlanId.trim() } : {}),
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

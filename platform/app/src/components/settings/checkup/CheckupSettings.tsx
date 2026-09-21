import { Skeleton, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { CheckGroup, CheckRow } from "~/server/checkup/verdict";
import { api } from "~/utils/api";

import { CheckupRows } from "./CheckupRows";
import { UsageReportSection } from "./UsageReportSection";

/**
 * Settings, Checkup: is this install correctly wired, and what does it send.
 *
 * Spec: specs/self-hosting/checkup/checkup.feature
 *
 * The free checks come with the page; the rows that cost egress or money keep
 * their "not run" verdict until an administrator presses the band's button,
 * and the answer replaces the row in place. The page holds no verdict of its
 * own: every row is the server's, and the same rows print from
 * `langwatch doctor`.
 */
export function CheckupSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  const canManage = hasPermission("organization:manage");
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

  if (status.isLoading || usageReport.isLoading) {
    return <Skeleton height="240px" width="full" />;
  }
  if (status.error) {
    return (
      <HandledErrorAlert
        error={status.error}
        fallbackTitle="Couldn't run the checkup"
        dismissible={false}
      />
    );
  }
  const data = status.data;
  if (data?.deployment !== "self-hosted") {
    return (
      <SettingsSection
        title="The checkup is for self-hosted installs"
        testId="checkup-saas"
      >
        <Text fontSize="sm" color="fg.muted">
          LangWatch Cloud is wired for you.
        </Text>
      </SettingsSection>
    );
  }

  const rows = data.rows.map((row) => explicitRows.get(row.id) ?? row);

  const runGroup = (group: CheckGroup) => {
    setRunningGroup(group);
    const checks = data.rows
      .filter((row) => row.group === group && row.cost !== "free")
      .map((row) => row.id);
    run.mutate({
      organizationId,
      checks,
      ...(group === "pipelines" && runPlanId.trim()
        ? { scenarioRunPlanId: runPlanId.trim() }
        : {}),
    });
  };

  const report = usageReport.data;

  return (
    <VStack width="full" align="stretch" gap={0}>
      <CheckupRows
        rows={rows}
        ranAt={data.ranAt}
        canManage={canManage}
        isRunning={runningGroup !== null}
        runPlanId={runPlanId}
        onRunPlanIdChange={setRunPlanId}
        onRun={runGroup}
      />
      {report && report.deployment === "self-hosted" ? (
        <UsageReportSection
          report={report}
          canManage={canManage}
          isSaving={setSwitches.isPending}
          onSwitch={(change) =>
            setSwitches.mutate({ organizationId, ...change })
          }
        />
      ) : null}
    </VStack>
  );
}

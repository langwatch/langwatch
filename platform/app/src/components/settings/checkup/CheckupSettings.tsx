import { Skeleton, Text, VStack } from "@chakra-ui/react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { HandledErrorAlert } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { CheckupRows } from "./CheckupRows";
import { UsageReportSection } from "./UsageReportSection";
import { useCheckupScreen } from "./useCheckupScreen";

/**
 * Settings, Checkup: is this install correctly wired, and what does it send.
 *
 * Spec: specs/self-hosting/checkup/checkup.feature
 *
 * Every row is the server's, and the same rows print from `langwatch doctor`.
 */
export function CheckupSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  const canManage = hasPermission("organization:manage");
  const screen = useCheckupScreen(organizationId);
  const { status, usageReport } = screen;

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

  const report = usageReport.data;

  return (
    <VStack width="full" align="stretch" gap={0}>
      <CheckupRows
        rows={screen.rowsWith(data.rows)}
        ranAt={data.ranAt}
        canManage={canManage}
        isRunning={screen.isRunning}
        runPlanId={screen.runPlanId}
        onRunPlanIdChange={screen.setRunPlanId}
        onRun={(group) => screen.runGroup(group, data.rows)}
      />
      {report && report.deployment === "self-hosted" ? (
        <UsageReportSection
          report={report}
          canManage={canManage}
          isSaving={screen.isSavingSwitches}
          onSwitch={(change) =>
            screen.setSwitches.mutate({ organizationId, ...change })
          }
        />
      ) : null}
    </VStack>
  );
}

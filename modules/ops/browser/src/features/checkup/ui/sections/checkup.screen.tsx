/**
 * Settings, Checkup: is this install wired, what is broken and how to fix it,
 * and exactly what it sends. The same rows print from `langwatch doctor`.
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { Alert, Skeleton, Text, VStack } from "@chakra-ui/react";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Cloud } from "lucide-react";

import { useCheckupScreen } from "../../behavior/use-checkup-screen.ts";
import { useCheckupHost } from "../../model/checkup-host.ts";
import { CheckupRows } from "./checkup-rows.tsx";
import { UsageReportSection } from "./usage-report-section.tsx";

export default function CheckupScreen() {
  const organizationId = useCheckupHost().organizationId();

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Checkup</PageLayout.Heading>
      </PageLayout.Header>
      <VStack align="stretch" gap={6} width="full" paddingTop={4}>
        <Text color="fg.muted">
          Whether this install is correctly wired, what is broken and how to fix it, and exactly
          what it sends to LangWatch.
        </Text>
        {organizationId ? <CheckupSettings organizationId={organizationId} /> : null}
      </VStack>
    </>
  );
}

function CheckupSettings({ organizationId }: { organizationId: string }) {
  const host = useCheckupHost();
  const canManage = host.canManageOrganization();
  const screen = useCheckupScreen(organizationId);
  const { status, usageReport } = screen;

  if (status.isLoading || usageReport.isLoading) {
    return <Skeleton height="240px" width="full" />;
  }
  if (status.error) {
    return (
      <Alert.Root status="error" data-testid="checkup-load-error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Couldn't run the checkup</Alert.Title>
          <Alert.Description>
            {host.describeFailure({
              error: status.error,
              fallbackTitle: "Couldn't run the checkup",
            })}
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  const data = status.data;
  if (data?.deployment !== "self-hosted") {
    return (
      <NoDataInfoBlock
        title="The checkup is for self-hosted installs"
        description="LangWatch Cloud is wired for you."
        icon={<Cloud />}
        testId="checkup-saas"
      />
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
          onSwitch={(change) => screen.setSwitches.mutate({ organizationId, ...change })}
        />
      ) : null}
    </VStack>
  );
}

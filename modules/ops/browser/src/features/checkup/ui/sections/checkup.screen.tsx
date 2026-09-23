/**
 * Settings, Checkup: is this install wired, what is broken and how to fix it,
 * and exactly what it sends. The same rows print from `langwatch doctor`.
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { Box, Heading, Skeleton, Text, VStack } from "@chakra-ui/react";

import { useCheckupScreen } from "../../behavior/use-checkup-screen.ts";
import { useCheckupHost } from "../../model/checkup-host.ts";
import { CheckupSection } from "../elements/checkup-section.tsx";
import { CheckupRows } from "./checkup-rows.tsx";
import { UsageReportSection } from "./usage-report-section.tsx";

export default function CheckupScreen() {
  const organizationId = useCheckupHost().organizationId();

  return (
    <Box paddingX={{ base: 4, md: 6 }} paddingY={4} width="full" maxWidth="820px">
      <VStack align="start" gap={1} paddingBottom={{ base: 5, md: 6 }}>
        <Heading size="lg">Checkup</Heading>
        <Text color="fg.muted">
          Whether this install is correctly wired, what is broken and how to fix it, and exactly
          what it sends to LangWatch.
        </Text>
      </VStack>
      {organizationId ? <CheckupSettings organizationId={organizationId} /> : null}
    </Box>
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
      <Text color="fg.error" data-testid="checkup-load-error">
        {host.describeFailure({ error: status.error, fallbackTitle: "Couldn't run the checkup" })}
      </Text>
    );
  }

  const data = status.data;
  if (data?.deployment !== "self-hosted") {
    return (
      <CheckupSection title="The checkup is for self-hosted installs" testId="checkup-saas">
        <Text fontSize="sm" color="fg.muted">
          LangWatch Cloud is wired for you.
        </Text>
      </CheckupSection>
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

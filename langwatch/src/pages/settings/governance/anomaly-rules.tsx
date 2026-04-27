import {
  Badge,
  Box,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bell } from "lucide-react";

import { NotFoundScene } from "~/components/NotFoundScene";
import SettingsLayout from "~/components/SettingsLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Anomaly rule authoring surface. The detection backend (rule
 * evaluation + alert dispatch) is in flight on the backend lane;
 * until it ships this page renders a placeholder so admins can find
 * the future surface but not author rules that wouldn't persist.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */

function AnomalyRulesPage() {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { projectId: project?.id, enabled: !!project },
  );

  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">Anomaly Rules</Heading>
              <Badge colorPalette="purple" size="sm" variant="surface">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted" fontSize="sm" maxW="3xl">
              Define thresholds that page on-call when activity drifts.
              Rules fire on the activity stream and surface on the{" "}
              <Link href="/settings/governance" color="orange.600">
                governance overview
              </Link>
              .
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={6}
          textAlign="center"
        >
          <VStack gap={3}>
            <Box color="fg.muted">
              <Bell size={32} />
            </Box>
            <Heading as="h3" size="sm">
              Available when the detection backend ships
            </Heading>
            <Text fontSize="sm" color="fg.muted" maxW="lg">
              The rule evaluation engine and destination dispatch
              (Slack / SIEM / webhook / PagerDuty) are in flight. Rules
              authored here will persist and start firing as soon as
              that backend lands.
            </Text>
          </VStack>
        </Box>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:manage", {})(
  AnomalyRulesPage,
);

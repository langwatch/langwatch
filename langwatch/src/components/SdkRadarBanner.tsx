import { Alert, Button, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { LuArrowRight } from "react-icons/lu";
import { useDrawer } from "~/hooks/useDrawer";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSdkRadarUpdateSnooze } from "~/hooks/useSdkRadarUpdateSnooze";
import { api } from "~/utils/api";

export function SdkRadarBanner() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const { isSnoozed } = useSdkRadarUpdateSnooze(project?.id);
  const { enabled: sdkRadarEnabled } = useFeatureFlag(
    "release_ui_sdk_radar_banner_card_enabled",
  );

  const stats = api.sdkRadar.getVersionStats.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && sdkRadarEnabled },
  );

  // Hide on homepage — the SdkRadarCard handles it there
  const isHomePage = router.pathname === "/[project]";

  if (!sdkRadarEnabled || isHomePage || !stats.data?.hasOutdated || isSnoozed) {
    return null;
  }

  return (
    <Alert.Root
      status="warning"
      width="full"
      borderBottom="1px solid"
      borderBottomColor="yellow.300"
    >
      <Alert.Indicator />
      <Alert.Content>
        <HStack width="full">
          <Text>
            Your LangWatch SDK is outdated. Update to get the latest features
            and fixes.
          </Text>
          <Button
            size="xs"
            variant="outline"
            colorPalette="orange"
            onClick={() => openDrawer("sdkRadar", {}, { resetStack: true })}
          >
            View details <LuArrowRight size={12} />
          </Button>
        </HStack>
      </Alert.Content>
    </Alert.Root>
  );
}

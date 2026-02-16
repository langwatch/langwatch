import { Button, Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import { LuArrowRight, LuBellOff } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { useSdkRadarUpdateSnooze } from "~/hooks/useSdkRadarUpdateSnooze";
import { api } from "~/utils/api";
import { HomeCard } from "./HomeCard";
import numeral from "numeral";

export function SdkRadarCard() {
  const { project } = useOrganizationTeamProject();
  const { isSnoozed, snooze } = useSdkRadarUpdateSnooze(project?.id);
  const { openDrawer } = useDrawer();

  const stats = api.sdkRadar.getVersionStats.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  if (!project || !stats.data || !stats.data.hasOutdated || isSnoozed) {
    return null;
  }

  const outdatedCount = stats.data.sdks.reduce((sum, sdk) => {
    return (
      sum +
      sdk.versions
        .filter((v) => v.isOutdated)
        .reduce((vSum, v) => vSum + v.count, 0)
    );
  }, 0);

  const outdatedSdkNames = stats.data.sdks
    .filter((sdk) => sdk.versions.some((v) => v.isOutdated))
    .map((sdk) => sdk.displayName);

  return (
    <HomeCard width="full" padding={4} borderColor="yellow.300" borderWidth={1}>
      <HStack width="full" gap={2} marginBottom={2}>
        <Heading size="sm" color="orange.500">
          SDK Radar: Update Recommended
        </Heading>
        <Spacer />
        <Button size="xs" variant="ghost" color="fg.muted" onClick={snooze}>
          <LuBellOff size={14} />
          Snooze 30 days
        </Button>
      </HStack>

      <HStack width="full" gap={4}>
        <Text fontSize="sm" color="fg.muted">
          {numeral(outdatedCount).format("0,0")} events in the last 7 days were
          sent from an outdated{" "}
          <Text as="span" fontWeight="bold" color="fg">
            {outdatedSdkNames.join(", ")}
          </Text>{" "}
          SDK.
        </Text>
        <Spacer />
        <Button
          size="sm"
          variant="outline"
          colorPalette="orange"
          onClick={() => openDrawer("sdkRadar", {}, { resetStack: true })}
        >
          View details <LuArrowRight size={12} />
        </Button>
      </HStack>
    </HomeCard>
  );
}

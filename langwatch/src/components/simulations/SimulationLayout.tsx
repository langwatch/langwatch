import {
  Box,
  HStack,
  IconButton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft } from "react-feather";
import {
  PeriodSelector,
  type Period,
  type PeriodMode,
  type RelativePresetKey,
} from "~/components/PeriodSelector";
import { useSimulationRouter } from "~/hooks/simulations";
import {
  isOnPlatformSet,
  ON_PLATFORM_DISPLAY_NAME,
} from "~/server/scenarios/internal-set-id";
import { Tooltip } from "../ui/tooltip";
import { DashboardLayout } from "../DashboardLayout";
import { SetRunHistorySidebar } from "./set-run-history-sidebar";

export const SimulationLayout = ({
  children,
  period,
  mode,
  setPeriod,
  setRelativePeriod,
}: {
  children: React.ReactNode;
  period: Period;
  mode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: RelativePresetKey) => void;
}) => {
  return (
    <DashboardLayout>
      <Header
        period={period}
        mode={mode}
        setPeriod={setPeriod}
        setRelativePeriod={setRelativePeriod}
      />
      <HStack w="full" h="full" alignItems="stretch" gap={0} bg="bg.surface">
        <Box
          w="340px"
          minW="340px"
          position="relative"
          h="full"
        >
          <SetRunHistorySidebar
            startDate={period.startDate.getTime()}
            endDate={period.endDate.getTime()}
          />
        </Box>
        <Box
          w="full"
          position="relative"
          h="full"
          borderTopLeftRadius="lg"
          overflow="hidden"
          bg="bg.muted"
          boxShadow="inset 3px 3px 10px 0 rgba(0, 0, 0, 0.05)"
        >
          {children}
        </Box>
      </HStack>
    </DashboardLayout>
  );
};

const Header = ({
  period,
  mode,
  setPeriod,
  setRelativePeriod,
}: {
  period: Period;
  mode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (presetKey: RelativePresetKey) => void;
}) => {
  const { scenarioSetId, goToSimulationSets } = useSimulationRouter();
  const displayName =
    scenarioSetId && isOnPlatformSet(scenarioSetId)
      ? ON_PLATFORM_DISPLAY_NAME
      : scenarioSetId ?? "unknown";
  return (
    <Box w="full" px={4} borderBottom="1px" bg="bg.surface" borderColor="border">
      <HStack gap={2} minH="44px" align="center">
        <Tooltip content="Back to simulations">
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Back to simulations"
            onClick={() => goToSimulationSets()}
          >
            <ArrowLeft size={16} />
          </IconButton>
        </Tooltip>
        <Text fontWeight="bold" fontSize="md">
          {displayName}
        </Text>
        <Spacer />
        <PeriodSelector
          period={period}
          mode={mode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
        />
      </HStack>
    </Box>
  );
};

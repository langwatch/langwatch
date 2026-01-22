import {
  Box,
  Button,
  Flex,
  HStack,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import { LuPanelLeftClose, LuPanelLeftOpen } from "react-icons/lu";
import { useSimulationRouter } from "~/hooks/simulations";
import { DashboardLayout } from "../DashboardLayout";
import { SetRunHistorySidebar } from "./set-run-history-sidebar";

// TODO: This file could be better organized.
export const SimulationLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { open: isHistorySidebarOpen, onToggle } = useDisclosure({
    defaultOpen: true,
  });

  return (
    <DashboardLayout>
      <Header
        isHistorySidebarOpen={isHistorySidebarOpen}
        onHistorySidebarOpenChange={onToggle}
      />
      <HStack w="full" h="full" alignItems="stretch" gap={0} bg="bg.surface">
        <Box
          w={isHistorySidebarOpen ? "500px" : "0px"}
          position="relative"
          h="full"
          transition="width 0.2s"
        >
          <SetRunHistorySidebar />
        </Box>
        <Box
          w="full"
          position="relative"
          h="full"
          borderTopLeftRadius={isHistorySidebarOpen ? "lg" : "0px"}
          transition="border-top-left-radius 0.2s"
          overflow="hidden"
          bg="bg.muted"
        >
          {children}
        </Box>
      </HStack>
    </DashboardLayout>
  );
};

const Header = ({
  isHistorySidebarOpen,
  onHistorySidebarOpenChange,
}: {
  isHistorySidebarOpen: boolean;
  onHistorySidebarOpenChange: (open: boolean) => void;
}) => {
  const { scenarioSetId } = useSimulationRouter();
  return (
    <Box w="full" p={4} borderBottom="1px" bg="bg.surface" borderColor="border">
      <HStack>
        <Button
          size="sm"
          bg={isHistorySidebarOpen ? "bg.emphasized" : "bg.muted"}
          onClick={() => onHistorySidebarOpenChange(!isHistorySidebarOpen)}
          title={isHistorySidebarOpen ? "Close History" : "Open History"}
        >
          {isHistorySidebarOpen ? (
            <LuPanelLeftClose size={18} />
          ) : (
            <LuPanelLeftOpen size={18} />
          )}
        </Button>
        <Flex alignItems="center" gap={1}>
          <Text fontWeight="semibold">
            <Text fontSize={"xs"} color={"fg.muted"} as="span">
              Scenario Set ID:
            </Text>{" "}
            <code>{scenarioSetId ?? "unknown"}</code>
          </Text>
        </Flex>
      </HStack>
    </Box>
  );
};

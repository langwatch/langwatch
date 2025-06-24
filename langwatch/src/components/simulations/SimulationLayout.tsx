import { Box, Button, HStack, Text, useDisclosure } from "@chakra-ui/react";
import { DashboardLayout } from "../DashboardLayout";
import { SetRunHistorySidebar } from "./set-run-history-sidebar";
import { useSimulationRouter } from "~/hooks/simulations";
import { LuPanelLeftClose, LuPanelLeftOpen } from "react-icons/lu";

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
      <HStack w="full" h="full" alignItems="stretch" gap={0} bg="white">
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
          bg="gray.100"
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
    <Box w="full" p={4} borderBottom="1px" bg="white" borderColor="gray.200">
      <HStack>
        <Button
          size="sm"
          bg={isHistorySidebarOpen ? "gray.200" : "gray.100"}
          onClick={() => onHistorySidebarOpenChange(!isHistorySidebarOpen)}
          title={isHistorySidebarOpen ? "Close History" : "Open History"}
        >
          {isHistorySidebarOpen ? (
            <LuPanelLeftClose size={18} />
          ) : (
            <LuPanelLeftOpen size={18} />
          )}
        </Button>
        <Text fontWeight="semibold">{scenarioSetId}</Text>
      </HStack>
    </Box>
  );
};

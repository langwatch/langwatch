import { Box, HStack } from "@chakra-ui/react";
import { DashboardLayout } from "../DashboardLayout";
import { SetRunHistorySidebar } from "./SetRunHistorySidebar";

export const LayoutWithSetRunHistory = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <DashboardLayout>
      <HStack w="full" h="full">
        <SetRunHistorySidebar />
        <Box w="full" position="relative" h="full">
          {children}
        </Box>
      </HStack>
    </DashboardLayout>
  );
};

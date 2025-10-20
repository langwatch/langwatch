import { Box, Button, HStack, Tabs, VStack } from "@chakra-ui/react";
import { Plus } from "react-feather";

interface BrowserLikeTabsRootProps {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  colorPalette?: string;
  height?: string;
}

function BrowserLikeTabsRoot({
  children,
  value,
  defaultValue,
  onValueChange,
  colorPalette = "orange",
  height = "full",
}: BrowserLikeTabsRootProps) {
  return (
    <VStack gap={0} height={height} align="stretch" bg="gray.50">
      <Tabs.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(change) => onValueChange?.(change.value)}
        colorPalette={colorPalette}
      >
        {children}
      </Tabs.Root>
    </VStack>
  );
}

interface BrowserLikeTabsBarProps {
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}

function BrowserLikeTabsBar({ children, rightSlot }: BrowserLikeTabsBarProps) {
  return (
    <HStack
      gap={0}
      width="full"
      bg="white"
      borderBottom="1px solid"
      borderColor="gray.200"
      paddingX={2}
    >
      {children}
      <HStack gap={1} marginLeft="auto">
        {rightSlot}
      </HStack>
    </HStack>
  );
}

function BrowserLikeTabsList({ children }: { children: React.ReactNode }) {
  return (
    <Tabs.List>
      <HStack gap={0} overflowX="auto">
        {children}
      </HStack>
    </Tabs.List>
  );
}

interface BrowserLikeTabsTriggerProps {
  value: string;
  children: React.ReactNode;
}

function BrowserLikeTabsTrigger({
  value,
  children,
}: BrowserLikeTabsTriggerProps) {
  return (
    <Tabs.Trigger
      value={value}
      paddingX={4}
      paddingY={2.5}
      minWidth="fit-content"
      borderRadius="md"
      marginBottom="-1px"
      cursor="pointer"
      transition="all 0.15s ease-in-out"
      bg="gray.50"
      color="gray.600"
      _hover={{ bg: "gray.30" }}
      _selected={{
        bg: "white",
        color: "gray.800",
      }}
    >
      <HStack gap={2}>
        <Box as="span" whiteSpace="nowrap" fontSize="sm" fontWeight="500">
          {children}
        </Box>
      </HStack>
    </Tabs.Trigger>
  );
}

interface BrowserLikeTabsContentProps {
  value: string;
  children: React.ReactNode;
}

function BrowserLikeTabsContent({
  value,
  children,
}: BrowserLikeTabsContentProps) {
  return (
    <Tabs.Content value={value}>
      <Box height="full" width="full" bg="white" overflow="hidden">
        {children}
      </Box>
    </Tabs.Content>
  );
}

export const BrowserLikeTabs = {
  Root: BrowserLikeTabsRoot,
  Bar: BrowserLikeTabsBar,
  List: BrowserLikeTabsList,
  Trigger: BrowserLikeTabsTrigger,
  Content: BrowserLikeTabsContent,
};

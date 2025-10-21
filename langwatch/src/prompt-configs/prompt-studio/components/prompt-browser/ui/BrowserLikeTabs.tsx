import { Box, HStack, Tabs, VStack, type StackProps } from "@chakra-ui/react";

interface BrowserLikeTabsRootProps extends StackProps {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  colorPalette?: string;
}

function BrowserLikeTabsRoot({
  children,
  value,
  defaultValue,
  onValueChange,
  colorPalette = "orange",
  ...props
}: BrowserLikeTabsRootProps) {
  return (
    <VStack
      height="full"
      {...props}
      gap={0}
      align="stretch"
      bg="gray.50"
      width="full"
      borderRight="1px solid"
      borderColor="gray.200"
    >
      <Tabs.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(change) => onValueChange?.(change.value)}
        colorPalette={colorPalette}
        width="full"
        height="full"
      >
        {children}
      </Tabs.Root>
    </VStack>
  );
}

interface BrowserLikeTabsBarProps {
  children: React.ReactNode;
}

function BrowserLikeTabsBar({ children }: BrowserLikeTabsBarProps) {
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
    </HStack>
  );
}

function BrowserLikeTabsList({ children }: { children: React.ReactNode }) {
  return (
    <Tabs.List width="full">
      <HStack gap={0} overflowX="auto" width="full">
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
      minWidth="fit-content"
      marginBottom="-1px"
      cursor="pointer"
      transition="all 0.15s ease-in-out"
      bg="gray.200"
      color="gray.600"
      _hover={{ bg: "gray.100" }}
      _selected={{
        bg: "white",
        color: "gray.800",
      }}
    >
      {children}
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
    <Tabs.Content
      value={value}
      width="full"
      height="full"
      bg="white"
      overflowY="scroll"
    >
      {children}
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

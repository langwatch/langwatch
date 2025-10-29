import { HStack, Tabs, VStack, type StackProps } from "@chakra-ui/react";

interface BrowserLikeTabsRootProps extends StackProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
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
    <VStack height="full" gap={0} align="stretch" width="full" {...props}>
      <Tabs.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(change) => onValueChange?.(change.value)}
        colorPalette={colorPalette}
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
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
    <HStack gap={0} width="full" bg="gray.100">
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
      bg="gray.100"
      color="gray.600"
      _hover={{ bg: "white" }}
      _selected={{
        bg: "white",
        color: "gray.800",
      }}
    >
      {children}
    </Tabs.Trigger>
  );
}

const BrowserLikeTabsContent = Tabs.Content;

export const BrowserLikeTabs = {
  Root: BrowserLikeTabsRoot,
  Bar: BrowserLikeTabsBar,
  List: BrowserLikeTabsList,
  Trigger: BrowserLikeTabsTrigger,
  Content: BrowserLikeTabsContent,
};

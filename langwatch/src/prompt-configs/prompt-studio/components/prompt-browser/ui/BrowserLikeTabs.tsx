import { HStack, Tabs, VStack, type StackProps } from "@chakra-ui/react";

/**
 * Props for BrowserLikeTabsRoot component
 */
interface BrowserLikeTabsRootProps extends StackProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

/**
 * BrowserLikeTabsRoot component
 * Single Responsibility: Provides root container for browser-like tabs with Chakra Tabs integration.
 * @param children - Child components (tab bar and content)
 * @param value - Controlled tab value
 * @param defaultValue - Default tab value
 * @param onValueChange - Callback fired when tab changes
 * @param colorPalette - Color scheme for tabs
 * @param props - Additional stack props
 */
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

/**
 * Props for BrowserLikeTabsBar component
 */
interface BrowserLikeTabsBarProps {
  children: React.ReactNode;
}

/**
 * BrowserLikeTabsBar component
 * Single Responsibility: Renders the tab bar container.
 * @param children - Tab list and additional controls
 */
function BrowserLikeTabsBar({ children }: BrowserLikeTabsBarProps) {
  return (
    <HStack gap={0} width="full" bg="gray.100">
      {children}
    </HStack>
  );
}

/**
 * BrowserLikeTabsList component
 * Single Responsibility: Renders the scrollable list of tab triggers.
 * @param children - Tab trigger components
 */
function BrowserLikeTabsList({ children }: { children: React.ReactNode }) {
  return (
    <Tabs.List width="full" gap={0} height="full">
      {children}
    </Tabs.List>
  );
}

/**
 * Props for BrowserLikeTabsTrigger component
 */
interface BrowserLikeTabsTriggerProps {
  value: string;
  children: React.ReactNode;
}

/**
 * BrowserLikeTabsTrigger component
 * Single Responsibility: Renders a single tab trigger with browser-like styling.
 * @param value - Tab identifier
 * @param children - Tab content/label
 */
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

/**
 * Compound component for browser-like tabs interface.
 *
 * @example
 * ```tsx
 * <BrowserLikeTabs.Root value="tab1" onValueChange={handleChange}>
 *   <BrowserLikeTabs.Bar>
 *     <BrowserLikeTabs.List>
 *       <BrowserLikeTabs.Trigger value="tab1">Tab 1</BrowserLikeTabs.Trigger>
 *     </BrowserLikeTabs.List>
 *   </BrowserLikeTabs.Bar>
 *   <BrowserLikeTabs.Content value="tab1">Content 1</BrowserLikeTabs.Content>
 * </BrowserLikeTabs.Root>
 * ```
 */
export const BrowserLikeTabs = {
  Root: BrowserLikeTabsRoot,
  Bar: BrowserLikeTabsBar,
  List: BrowserLikeTabsList,
  Trigger: BrowserLikeTabsTrigger,
  Content: BrowserLikeTabsContent,
};

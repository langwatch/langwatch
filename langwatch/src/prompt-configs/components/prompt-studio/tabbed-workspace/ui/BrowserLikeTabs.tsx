import { Box, HStack, Button, VStack } from "@chakra-ui/react";
import { Plus, X } from "react-feather";
import { useContext, createContext } from "react";

interface Tab {
  id: string;
  title: string;
  hasUnsavedChanges?: boolean;
}

interface BrowserLikeTabsContextValue {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onAddTab: () => void;
}

const BrowserLikeTabsContext =
  createContext<BrowserLikeTabsContextValue | null>(null);

function useBrowserLikeTabs(): BrowserLikeTabsContextValue {
  const context = useContext(BrowserLikeTabsContext);
  if (!context) {
    throw new Error(
      "BrowserLikeTabs components must be used within BrowserLikeTabs.Root",
    );
  }
  return context;
}

interface BrowserLikeTabsRootProps {
  children: React.ReactNode;
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onAddTab: () => void;
  height?: string;
}

function BrowserLikeTabsRoot({
  children,
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onAddTab,
  height = "calc(100vh - 200px)",
}: BrowserLikeTabsRootProps) {
  const contextValue: BrowserLikeTabsContextValue = {
    tabs,
    activeTabId,
    onTabChange,
    onTabClose,
    onAddTab,
  };

  return (
    <BrowserLikeTabsContext.Provider value={contextValue}>
      <VStack gap={0} height={height} align="stretch" bg="gray.50">
        <BrowserLikeTabsBar />
        <Box flex={1} overflow="hidden">
          {children}
        </Box>
      </VStack>
    </BrowserLikeTabsContext.Provider>
  );
}

function BrowserLikeTabsBar() {
  const { tabs, activeTabId, onTabChange, onTabClose, onAddTab } =
    useBrowserLikeTabs();

  return (
    <HStack
      gap={0}
      width="full"
      bg="white"
      borderBottom="1px solid"
      borderColor="gray.200"
    >
      <HStack gap={0} overflowX="auto" flex={1}>
        {tabs.map((tab) => (
          <BrowserLikeTabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => onTabChange(tab.id)}
            onClose={() => onTabClose(tab.id)}
          />
        ))}
      </HStack>
      <Button
        size="sm"
        variant="ghost"
        color="gray.500"
        onClick={onAddTab}
        marginRight={2}
        paddingX={2}
      >
        <Plus width="16px" />
      </Button>
    </HStack>
  );
}

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function BrowserLikeTabItem({
  tab,
  isActive,
  onSelect,
  onClose,
}: TabItemProps) {
  const { tabs } = useBrowserLikeTabs();

  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      cursor="pointer"
      bg={isActive ? "orange.50" : "transparent"}
      borderBottom={isActive ? "2px solid" : "2px solid transparent"}
      borderColor={isActive ? "orange.400" : "transparent"}
      color={isActive ? "orange.700" : "gray.600"}
      _hover={{ bg: isActive ? "orange.50" : "gray.50" }}
      onClick={onSelect}
      minWidth="fit-content"
      position="relative"
    >
      <Box as="span" whiteSpace="nowrap" fontSize="sm" fontWeight="medium">
        {tab.title}
        {tab.hasUnsavedChanges && (
          <Box
            as="span"
            marginLeft={1}
            width="6px"
            height="6px"
            borderRadius="full"
            bg="orange.400"
            display="inline-block"
          />
        )}
      </Box>
      {tabs.length > 1 && (
        <Box
          role="button"
          borderRadius="4px"
          transition="background 0.1s"
          padding={1}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          color={isActive ? "orange.400" : "gray.500"}
          css={{
            "&:hover": { background: "var(--chakra-colors-gray-100)" },
          }}
        >
          <X width="12px" />
        </Box>
      )}
    </HStack>
  );
}

interface BrowserLikeTabProps {
  children: React.ReactNode;
  value: string;
  title: string;
  hasUnsavedChanges?: boolean;
}

function BrowserLikeTab({
  children: _children,
  value: _value,
  title: _title,
  hasUnsavedChanges: _hasUnsavedChanges,
}: BrowserLikeTabProps) {
  // This component is just for JSX structure purposes
  // Tab management is handled by the parent component
  return null;
}

interface BrowserLikeTabsContentProps {
  children: React.ReactNode;
  value: string;
}

function BrowserLikeTabsContent({
  children,
  value,
}: BrowserLikeTabsContentProps) {
  const { activeTabId } = useBrowserLikeTabs();

  if (value !== activeTabId) {
    return null;
  }

  return (
    <Box
      display="block"
      height="full"
      width="full"
      bg="white"
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

export const BrowserLikeTabs = {
  Root: BrowserLikeTabsRoot,
  Tab: BrowserLikeTab,
  Content: BrowserLikeTabsContent,
};

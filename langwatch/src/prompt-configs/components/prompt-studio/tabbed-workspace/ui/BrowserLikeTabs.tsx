import { Box, HStack, Button, VStack } from "@chakra-ui/react";
import { Plus, X } from "react-feather";
import { useState, useEffect, useContext, createContext } from "react";

interface Tab {
  id: string;
  title: React.ReactNode;
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

// Add a tab registry context to manage tabs internally
interface TabRegistryContextValue {
  registerTab: (tab: Tab) => void;
  unregisterTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  tabs: Tab[];
}

const TabRegistryContext = createContext<TabRegistryContextValue | null>(null);

function useTabRegistry() {
  const context = useContext(TabRegistryContext);
  if (!context) {
    throw new Error(
      "BrowserLikeTabs.Tab must be used within BrowserLikeTabs.Root",
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
  tabs: initialTabs = [],
  activeTabId: initialActiveTabId,
  onTabChange,
  onTabClose,
  onAddTab,
  height = "full",
}: BrowserLikeTabsRootProps) {
  const [tabs, setTabs] = useState<Tab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialActiveTabId);

  // Register a tab with the internal state
  const registerTab = (tab: Tab) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === tab.id);
      if (existing) {
        return prev.map((t) => (t.id === tab.id ? { ...t, ...tab } : t));
      }
      return [...prev, tab];
    });
  };

  // Unregister a tab
  const unregisterTab = (tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
  };

  // Update a tab's properties
  const updateTab = (tabId: string, updates: Partial<Tab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    );
  };

  const contextValue: BrowserLikeTabsContextValue = {
    tabs,
    activeTabId,
    onTabChange: (tabId) => {
      setActiveTabId(tabId);
      onTabChange?.(tabId);
    },
    onTabClose: (tabId) => {
      if (tabs.length > 1) {
        const newTabs = tabs.filter((t) => t.id !== tabId);
        setTabs(newTabs);
        onTabClose?.(tabId);

        // If closing the active tab, select another tab
        if (tabId === activeTabId) {
          const newActiveTab = newTabs[0]?.id ?? "";
          setActiveTabId(newActiveTab);
          onTabChange?.(newActiveTab);
        }
      }
    },
    onAddTab: () => {
      onAddTab?.();
    },
  };

  const registryContextValue: TabRegistryContextValue = {
    registerTab,
    unregisterTab,
    updateTab,
    tabs,
  };

  return (
    <TabRegistryContext.Provider value={registryContextValue}>
      <BrowserLikeTabsContext.Provider value={contextValue}>
        <VStack gap={0} height={height} align="stretch" bg="gray.50">
          <BrowserLikeTabsBar />
          <Box flex={1} overflow="hidden">
            {children}
          </Box>
        </VStack>
      </BrowserLikeTabsContext.Provider>
    </TabRegistryContext.Provider>
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
      paddingX={2}
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
        marginRight={1}
        paddingX={2}
        _hover={{ bg: "gray.100" }}
        borderRadius="md"
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
      paddingX={4}
      paddingY={2.5}
      cursor="pointer"
      bg={isActive ? "white" : "gray.50"}
      color={isActive ? "grey.800" : "gray.600"}
      _hover={{ bg: isActive ? "grey.50" : "gray.30" }}
      onClick={onSelect}
      minWidth="fit-content"
      position="relative"
      borderRadius="md"
      marginBottom="-1px"
      transition="all 0.15s ease-in-out"
    >
      <Box as="span" whiteSpace="nowrap" fontSize="sm" fontWeight="500">
        {tab.title}
      </Box>
      {tab.hasUnsavedChanges && (
        // Indicator light for unsaved changes
        <Box
          as="span"
          marginLeft={1.5}
          width="10px"
          height="10px"
          borderRadius="full"
          bg="orange.400"
          display="inline-block"
        />
      )}
      {tabs.length > 1 && (
        <Box
          role="button"
          borderRadius="3px"
          transition="all 0.1s ease-in-out"
          padding={0.5}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X width="18px" />
        </Box>
      )}
    </HStack>
  );
}

export interface BrowserLikeTabProps {
  children: React.ReactNode;
  value: string;
  title: React.ReactNode;
  hasUnsavedChanges?: boolean;
}

function BrowserLikeTab({
  value,
  title,
  hasUnsavedChanges,
}: BrowserLikeTabProps) {
  const { registerTab, unregisterTab, updateTab } = useTabRegistry();

  useEffect(() => {
    // Register the tab when component mounts
    registerTab({ id: value, title, hasUnsavedChanges });

    // Return cleanup function to unregister when component unmounts
    return () => unregisterTab(value);
  }, [value, title, hasUnsavedChanges, registerTab, unregisterTab]);

  // Update tab properties when props change
  useEffect(() => {
    updateTab(value, { title, hasUnsavedChanges });
  }, [title, hasUnsavedChanges, value, updateTab]);

  // This component is still just for JSX structure purposes
  // The actual content is handled by BrowserLikeTabsContent
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

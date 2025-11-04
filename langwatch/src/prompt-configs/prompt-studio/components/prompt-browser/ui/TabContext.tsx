import { createContext, useContext } from "react";

const TabIdContext = createContext<string | null>(null);

/**
 * TabIdProvider
 * Single Responsibility: Provide tab ID context to child components within a specific tab's scope.
 */
export function TabIdProvider({
  tabId,
  children,
}: {
  tabId: string;
  children: React.ReactNode;
}) {
  return (
    <TabIdContext.Provider value={tabId}>{children}</TabIdContext.Provider>
  );
}

/**
 * useTabId
 * Single Responsibility: Retrieve the current tab ID from context with runtime validation.
 */
export function useTabId() {
  const tabId = useContext(TabIdContext);
  if (!tabId) throw new Error("useTabId must be used within TabIdProvider");
  return tabId;
}

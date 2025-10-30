import { createContext, useContext } from "react";

const TabIdContext = createContext<string | null>(null);

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

export function useTabId() {
  const tabId = useContext(TabIdContext);
  if (!tabId) throw new Error("useTabId must be used within TabIdProvider");
  return tabId;
}

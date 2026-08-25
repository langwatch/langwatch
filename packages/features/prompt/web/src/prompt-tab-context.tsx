import { createContext, useContext } from "react";

const promptTabIdContext = createContext<string | null>(null);

export function TabIdProvider({
  tabId,
  children,
}: {
  tabId: string;
  children: React.ReactNode;
}) {
  return (
    <promptTabIdContext.Provider value={tabId}>{children}</promptTabIdContext.Provider>
  );
}

export function useTabId(): string {
  const tabId = useContext(promptTabIdContext);

  if (!tabId) {
    throw new Error("useTabId must be used within TabIdProvider");
  }

  return tabId;
}

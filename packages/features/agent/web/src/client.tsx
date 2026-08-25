import type { AgentService } from "@langwatch/agent-contract";
import { createContext, type ReactNode, useContext } from "react";

export type AgentsClient = Pick<
  AgentService,
  | "getAll"
  | "getById"
  | "create"
  | "update"
  | "archive"
  | "relatedEntities"
  | "cascadeArchive"
  | "getCopies"
  | "copy"
  | "pushToCopies"
  | "syncFromSource"
  | "getHistory"
>;

const AgentsClientContext = createContext<AgentsClient | null>(null);

export function AgentsClientProvider({
  client,
  children,
}: {
  client: AgentsClient;
  children: ReactNode;
}) {
  return (
    <AgentsClientContext.Provider value={client}>{children}</AgentsClientContext.Provider>
  );
}

export function useAgentsClient(): AgentsClient {
  const client = useContext(AgentsClientContext);
  if (!client) {
    throw new Error("useAgentsClient must be used inside AgentsClientProvider");
  }
  return client;
}

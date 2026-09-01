import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { PromptRef } from "../model/trace-generator";

export type FoundryProject = {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  orgName: string;
  teamName: string;
};

export type FoundryCurrentProject = {
  id: string;
  apiKey: string;
};

export type FoundryTransport = {
  currentProject: FoundryCurrentProject | undefined;
  projects: FoundryProject[];
  loadPrompts: (projectId: string) => Promise<PromptRef[]>;
};

const FoundryRuntimeContext = createContext<FoundryTransport | null>(null);

export function FoundryRuntimeProvider({
  children,
  transport,
}: {
  children: ReactNode;
  transport: FoundryTransport;
}) {
  return (
    <FoundryRuntimeContext.Provider value={transport}>
      {children}
    </FoundryRuntimeContext.Provider>
  );
}

export function useFoundryTransport(): FoundryTransport {
  const transport = useContext(FoundryRuntimeContext);
  if (!transport) {
    throw new Error("Foundry components must be rendered inside FoundryRuntimeProvider");
  }

  return transport;
}

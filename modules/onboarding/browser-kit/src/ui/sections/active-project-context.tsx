import type React from "react";
import { createContext, useContext } from "react";

import type {
  MinimalOrganization,
  MinimalProject,
} from "../../behavior/use-project-by-slug-or-latest.ts";

export interface ActiveProjectContextValue {
  project?: MinimalProject;
  organization?: MinimalOrganization;
  /**
   * The raw API token freshly minted this session (once, by the create
   * mutation); undefined after a refresh. Consumers needing the raw key
   * use this over `project.apiKey`, to show a mint CTA instead of a stale key.
   */
  freshToken?: string;
  /**
   * Callback to store a freshly-minted token. Called by any sub-surface
   * (e.g. the MCP tab's inline "Mint a key" CTA) that mints a new token
   * so the parent can update `freshToken` + `project.apiKey` for all tabs.
   */
  onFreshToken?: (token: string) => void;
}

const ActiveProjectContext = createContext<ActiveProjectContextValue | undefined>(undefined);

export function ActiveProjectProvider({
  value,
  children,
}: {
  value: ActiveProjectContextValue;
  children: React.ReactNode;
}): React.ReactElement {
  return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
}

export function useActiveProject(): ActiveProjectContextValue {
  const ctx = useContext(ActiveProjectContext);
  return ctx ?? {};
}

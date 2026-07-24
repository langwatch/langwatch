import type React from "react";
import { createContext, useContext } from "react";
import type {
  MinimalOrganization,
  MinimalProject,
} from "~/hooks/useProjectBySlugOrLatest";

export interface ActiveProjectContextValue {
  project?: MinimalProject;
  organization?: MinimalOrganization;
  /**
   * The raw API token that was freshly minted in this session (returned
   * once by the create mutation). Undefined when no token has been minted
   * yet, or after a page refresh. Consumers that need to display the raw
   * key (e.g. MCP config JSON) use this instead of `project.apiKey` so
   * they can detect "no fresh token" and show a mint-a-key CTA rather
   * than silently falling back to a stale / DB key.
   */
  freshToken?: string;
  /**
   * Callback to store a freshly-minted token. Called by any sub-surface
   * (e.g. the MCP tab's inline "Mint a key" CTA) that mints a new token
   * so the parent can update `freshToken` + `project.apiKey` for all tabs.
   */
  onFreshToken?: (token: string) => void;
}

const ActiveProjectContext = createContext<
  ActiveProjectContextValue | undefined
>(undefined);

export function ActiveProjectProvider({
  value,
  children,
}: {
  value: ActiveProjectContextValue;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ActiveProjectContext.Provider value={value}>
      {children}
    </ActiveProjectContext.Provider>
  );
}

export function useActiveProject(): ActiveProjectContextValue {
  const ctx = useContext(ActiveProjectContext);
  return ctx ?? {};
}

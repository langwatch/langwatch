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
   * yet, or after a page refresh. The project's own key is never readable,
   * so every snippet that needs a real key reads this and shows a
   * placeholder plus a mint-a-key CTA when it is missing.
   */
  freshToken?: string;
  /**
   * Callback to store a freshly-minted token. Called by any sub-surface
   * (e.g. the MCP tab's inline "Mint a key" CTA) that mints a new token
   * so the parent can update `freshToken` for all tabs.
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

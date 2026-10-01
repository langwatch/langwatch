import type { PersonalTokenMint } from "@langwatch/api-key-client";
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
   * mutation); undefined after a refresh. Held in component state only.
   */
  freshToken?: string;
  /** Mints `freshToken` for every tab; dropped when the project, organisation or user changes. */
  minting?: PersonalTokenMint;
  /** Mints the MCP config's own token, project reads only; `freshToken` stays for `.env`. */
  mcpMinting?: PersonalTokenMint;
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

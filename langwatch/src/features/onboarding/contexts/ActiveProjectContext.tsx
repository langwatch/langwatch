import type React from "react";
import { createContext, useContext } from "react";
import type {
  MinimalOrganization,
  MinimalProject,
} from "~/hooks/useProjectBySlugOrLatest";

export interface ActiveProjectContextValue {
  project?: MinimalProject;
  organization?: MinimalOrganization;
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

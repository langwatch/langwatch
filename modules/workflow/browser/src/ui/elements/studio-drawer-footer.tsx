import { createContext, type ReactNode, useContext, useEffect } from "react";

import { useStudioDrawerFooterSlice } from "../../behavior/studio-drawer-footer.store.ts";

/** Lets a properties panel omit controls already rendered by its drawer. */
const InsideDrawerContext = createContext(false);

export function InsideDrawerProvider({ children }: { children: ReactNode }) {
  return <InsideDrawerContext.Provider value={true}>{children}</InsideDrawerContext.Provider>;
}

export function useInsideDrawer(): boolean {
  return useContext(InsideDrawerContext);
}

export function useRegisterDrawerFooter(footer: ReactNode): void {
  const register = useStudioDrawerFooterSlice((state) => state.register);
  useEffect(() => {
    if (footer === null) return;
    register(footer);
    return () => register(null);
  }, [footer, register]);
}

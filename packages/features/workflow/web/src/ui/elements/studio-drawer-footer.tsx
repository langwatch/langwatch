import { createContext, useContext, useEffect, type ReactNode } from "react";

/** Lets a properties panel omit controls already rendered by its drawer. */
const InsideDrawerContext = createContext(false);

/** Lets drawer content register actions in the wrapper's footer slot. */
export const DrawerFooterContext = createContext<((footer: ReactNode) => void) | null>(
  null,
);

export function InsideDrawerProvider({ children }: { children: ReactNode }) {
  return (
    <InsideDrawerContext.Provider value={true}>{children}</InsideDrawerContext.Provider>
  );
}

export function useInsideDrawer(): boolean {
  return useContext(InsideDrawerContext);
}

export function useRegisterDrawerFooter(footer: ReactNode): void {
  const setFooter = useContext(DrawerFooterContext);
  useEffect(() => {
    setFooter?.(footer);
    return () => setFooter?.(null);
  }, [footer, setFooter]);
}

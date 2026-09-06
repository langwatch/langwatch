import { createContext, useContext, useEffect } from "react";

/**
 * Context that signals to descendant components (primarily BasePropertiesPanel)
 * that they are rendered inside a StudioDrawerWrapper.
 *
 * When true, BasePropertiesPanel hides its own header (icon, name,
 * play/expand/close buttons) because the drawer wrapper already provides those.
 */
const InsideDrawerContext = createContext(false);

/**
 * Context for child components to register a footer with StudioDrawerWrapper.
 * The drawer wrapper renders the registered footer in its Drawer.Footer slot.
 */
export const DrawerFooterContext = createContext<
  ((footer: React.ReactNode) => void) | null
>(null);

export function InsideDrawerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <InsideDrawerContext.Provider value={true}>
      {children}
    </InsideDrawerContext.Provider>
  );
}

/**
 * Returns true when the component is rendered inside a StudioDrawerWrapper.
 * Used by BasePropertiesPanel to suppress its own header and sizing constraints.
 */
export function useInsideDrawer(): boolean {
  return useContext(InsideDrawerContext);
}

/**
 * Registers a footer with the parent StudioDrawerWrapper.
 * The footer is rendered in the drawer's footer slot.
 * Automatically cleans up on unmount.
 */
export function useRegisterDrawerFooter(footer: React.ReactNode): void {
  const setFooter = useContext(DrawerFooterContext);
  useEffect(() => {
    setFooter?.(footer);
    return () => setFooter?.(null);
  }, [footer, setFooter]);
}

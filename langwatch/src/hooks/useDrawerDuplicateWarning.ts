import { useEffect } from "react";
import { isDrawerMountedGlobally } from "~/components/CurrentDrawer";

/**
 * Hook that warns in development if a drawer is being rendered
 * while CurrentDrawer already has it mounted.
 * 
 * Add this to drawer components to catch duplicate rendering bugs.
 * 
 * @param drawerType - The drawer type from drawerRegistry (e.g., "agentHttpEditor")
 * 
 * @example
 * function AgentHttpEditorDrawer(props) {
 *   useDrawerDuplicateWarning("agentHttpEditor");
 *   // ...
 * }
 */
export function useDrawerDuplicateWarning(drawerType: string) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    if (isDrawerMountedGlobally(drawerType)) {
      console.warn(
        `[Drawer Duplicate] "${drawerType}" is rendered explicitly but CurrentDrawer ` +
          `already handles it. Remove the explicit drawer from the page.`
      );
    }
  }, [drawerType]);
}

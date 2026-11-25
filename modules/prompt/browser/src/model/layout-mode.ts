import { createContext, useContext } from "react";

/** How a prompt window stacks its editor and its chat. */
export type LayoutMode = "vertical" | "horizontal";

/** Context for sharing layout mode with nested components */
export const LayoutModeContext = createContext<LayoutMode>("vertical");

/** Hook to get the current layout mode */
export const useLayoutMode = () => useContext(LayoutModeContext);

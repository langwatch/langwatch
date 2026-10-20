import { createContext, type ReactNode, useContext } from "react";

/**
 * Sidebar item density (comfortable/compact) in context, shared across menu
 * components. Specs: product-sidebars.feature, settings-shell-v2.feature
 */
export type SideMenuDensity = "comfortable" | "compact";

export interface SideMenuDensityTokens {
  /** Menu item label text style. */
  textStyle: "body" | "bodySm";
  /** Space between the icon and the label, in Chakra spacing units. */
  gap: number;
  /** Horizontal padding inside a menu item, in Chakra spacing units. */
  paddingX: number;
  /** Menu item height. */
  height: string;
  /** Icon edge length, in pixels. */
  iconSize: number;
}

export const SIDE_MENU_DENSITIES: Record<SideMenuDensity, SideMenuDensityTokens> = {
  comfortable: {
    textStyle: "body",
    gap: 3,
    paddingX: 3,
    height: "32px",
    iconSize: 16,
  },
  compact: {
    textStyle: "bodySm",
    gap: 2.5,
    paddingX: 2,
    height: "29px",
    iconSize: 15,
  },
};

const SideMenuDensityContext = createContext<SideMenuDensity>("comfortable");

export function SideMenuDensityProvider({
  density,
  children,
}: {
  density: SideMenuDensity;
  children: ReactNode;
}) {
  return (
    <SideMenuDensityContext.Provider value={density}>{children}</SideMenuDensityContext.Provider>
  );
}

/** The sizes to draw a sidebar menu item with, at the current density. */
export function useSideMenuDensity(): SideMenuDensityTokens {
  return SIDE_MENU_DENSITIES[useContext(SideMenuDensityContext)];
}

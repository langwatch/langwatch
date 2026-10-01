import { createContext, type ReactNode, useContext } from "react";

/**
 * Sidebar item density (comfortable/compact) in context, shared across menu
 * components. Specs: product-sidebars.feature, settings-shell-v2.feature
 */
export type SideMenuDensity = "comfortable" | "compact";

export interface SideMenuSectionLabelTokens {
  fontSize: string;
  fontWeight: string;
  letterSpacing: string;
}

export interface SideMenuDensityTokens {
  /** Menu item label size. */
  fontSize: string;
  /** Space between the icon and the label, in Chakra spacing units. */
  gap: number;
  /** Horizontal padding inside a menu item, in Chakra spacing units. */
  paddingX: number;
  /** Menu item height. */
  height: string;
  /** Icon edge length, in pixels. */
  iconSize: number;
  /** The heading above a group of menu items. */
  sectionLabel: SideMenuSectionLabelTokens;
}

export const SIDE_MENU_DENSITIES: Record<SideMenuDensity, SideMenuDensityTokens> = {
  comfortable: {
    fontSize: "14px",
    gap: 3,
    paddingX: 3,
    height: "32px",
    iconSize: 16,
    sectionLabel: {
      fontSize: "11px",
      fontWeight: "medium",
      letterSpacing: "normal",
    },
  },
  compact: {
    fontSize: "13px",
    gap: 2.5,
    paddingX: 2,
    height: "29px",
    iconSize: 15,
    sectionLabel: {
      fontSize: "10px",
      fontWeight: "semibold",
      letterSpacing: "0.09em",
    },
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

import { SidebarSection as SidebarSectionView } from "@langwatch/design-system/app-shell";
import type React from "react";

import { useSidebarSectionState } from "../../behavior/use-sidebar-section-state.ts";
import { SideMenuSectionLabel } from "../elements/side-menu-section-label.tsx";

type SidebarSectionProps = {
  id: string;
  label: string;
  children: React.ReactNode;
  showExpanded: boolean;
  defaultExpanded?: boolean;
  /** The `data-tour` target the guided tour spotlights: the label and the items together. */
  tourId?: string;
};

/** The design system's sidebar section, open or closed as this person last left it. */
export const SidebarSection = ({
  id,
  label,
  children,
  showExpanded,
  defaultExpanded = true,
  tourId,
}: SidebarSectionProps) => {
  const { isExpanded, toggleSection } = useSidebarSectionState({ id, defaultExpanded });

  return (
    <SidebarSectionView
      label={label}
      heading={<SideMenuSectionLabel label={label} />}
      isExpanded={isExpanded}
      onToggle={toggleSection}
      showExpanded={showExpanded}
      tourId={tourId}
    >
      {children}
    </SidebarSectionView>
  );
};

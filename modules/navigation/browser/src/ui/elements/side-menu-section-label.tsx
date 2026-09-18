import { Text } from "@chakra-ui/react";

import { useSideMenuDensity } from "./side-menu-density.tsx";

/**
 * The heading above a group of sidebar menu items ("OBSERVE",
 * "ORGANIZATION"): one component for the current chrome and navigation-v2
 * sidebars, so the two cannot drift; reads its size from menu density.
 */
export function SideMenuSectionLabel({ label }: { label: string }) {
  const { sectionLabel } = useSideMenuDensity();

  return (
    <Text
      fontSize={sectionLabel.fontSize}
      fontWeight={sectionLabel.fontWeight}
      letterSpacing={sectionLabel.letterSpacing}
      textTransform="uppercase"
      whiteSpace="nowrap"
    >
      {label}
    </Text>
  );
}

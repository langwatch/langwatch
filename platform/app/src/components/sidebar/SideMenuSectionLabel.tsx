import { Text } from "@chakra-ui/react";
import { useSideMenuDensity } from "./sideMenuDensity";

/**
 * The heading above a group of sidebar menu items ("OBSERVE",
 * "ORGANIZATION"). One component for the current chrome and the
 * navigation-v2 sidebars, so the two cannot drift; it reads its size
 * from the menu density in context.
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

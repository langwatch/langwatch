import { Text } from "@langwatch/design-system/primitives";

import { useSideMenuDensity } from "./side-menu-density.tsx";

/**
 * The heading above a group of sidebar menu items ("OBSERVE",
 * "ORGANIZATION"): one component for the current chrome and navigation-v2
 * sidebars, so the two cannot drift; reads its size from menu density.
 */
export function SideMenuSectionLabel({
  label,
  isSentenceCase = false,
}: {
  label: string;
  /** The Settings and Admin sidebars: 12px medium sentence case, at 4.5:1 in both modes. */
  isSentenceCase?: boolean;
}) {
  const { sectionLabel } = useSideMenuDensity();

  if (isSentenceCase) {
    return (
      <Text
        fontSize="12px"
        lineHeight="16px"
        fontWeight="medium"
        color="nav.fgMuted"
        whiteSpace="nowrap"
      >
        {label}
      </Text>
    );
  }

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

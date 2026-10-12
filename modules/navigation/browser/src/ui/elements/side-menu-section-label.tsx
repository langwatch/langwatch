import { Text } from "@langwatch/design-system/primitives";

/** A sidebar group label: 12px medium sentence case, at 4.5:1 in both modes. */
export function SideMenuSectionLabel({ label }: { label: string }) {
  return (
    <Text textStyle="groupLabel" color="nav.fgMuted" whiteSpace="nowrap">
      {label}
    </Text>
  );
}

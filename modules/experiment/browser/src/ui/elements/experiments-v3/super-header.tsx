import { Box, HStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

type SuperHeaderProps = {
  colSpan: number;
  icon: ReactNode;
  children: ReactNode;
};

/**
 * One section's title cell over its columns. The grid's css sizes, pads and
 * borders it; use DatasetSuperHeader or TargetSuperHeader for the sections.
 */
export function SuperHeader({ colSpan, icon, children }: SuperHeaderProps) {
  return (
    <th colSpan={colSpan}>
      <HStack gap={2}>
        <Box color="fg.muted" display="flex" flexShrink={0} css={{ "& svg": { boxSize: "14px" } }}>
          {icon}
        </Box>
        {children}
      </HStack>
    </th>
  );
}

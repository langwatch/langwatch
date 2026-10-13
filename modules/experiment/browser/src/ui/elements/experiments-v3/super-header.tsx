import { HStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { ColorfulBlockIcon, type StudioPalette } from "../workflow/workflow-icons.tsx";

type SuperHeaderProps = {
  colSpan: number;
  colorPalette: StudioPalette;
  icon: ReactNode;
  children: ReactNode;
};

/**
 * One section's title cell over its columns. The grid's css sizes, pads and
 * borders it; use DatasetSuperHeader or TargetSuperHeader for the sections.
 */
export function SuperHeader({ colSpan, colorPalette, icon, children }: SuperHeaderProps) {
  return (
    <th colSpan={colSpan}>
      <HStack gap={2}>
        <ColorfulBlockIcon colorPalette={colorPalette} size="sm" icon={icon} flexShrink={0} />
        {children}
      </HStack>
    </th>
  );
}

import { HStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { ColorfulBlockIcon, type StudioPalette } from "../workflow/workflow-icons.tsx";

type SuperHeaderProps = {
  colSpan: number;
  colorPalette: StudioPalette;
  icon: ReactNode;
  children: ReactNode;
  paddingLeft?: string;
};

/**
 * Base super header component that handles the table cell styling.
 * Use DatasetSuperHeader or TargetSuperHeader for specific implementations.
 */
export function SuperHeader({
  colSpan,
  colorPalette,
  icon,
  children,
  paddingLeft = "12px",
}: SuperHeaderProps) {
  return (
    <th
      colSpan={colSpan}
      style={{
        padding: "12px 12px",
        paddingLeft,
        textAlign: "left",
        borderBottom: "1px solid var(--chakra-colors-border)",
        backgroundColor: "var(--chakra-colors-bg-panel)",
        height: "48px",
      }}
    >
      <HStack gap={2}>
        <ColorfulBlockIcon colorPalette={colorPalette} size="sm" icon={icon} />
        {children}
      </HStack>
    </th>
  );
}

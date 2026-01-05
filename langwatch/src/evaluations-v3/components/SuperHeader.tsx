import { HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";

type SuperHeaderProps = {
  colSpan: number;
  color: string;
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
  color,
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
        borderBottom: "1px solid var(--chakra-colors-gray-200)",
        backgroundColor: "white",
        height: "48px",
      }}
    >
      <HStack gap={2}>
        <ColorfulBlockIcon color={color} size="sm" icon={icon} />
        {children}
      </HStack>
    </th>
  );
}


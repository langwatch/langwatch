import { Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** The quiet label a section of the role drawer leads with. */
export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="caption" color="fg.subtle">
      {children}
    </Text>
  );
}

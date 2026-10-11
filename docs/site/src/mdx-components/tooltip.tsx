import { Tooltip as DsTooltip } from "@langwatch/design-system/tooltip";
import type { ReactNode } from "react";

export function Tooltip({ tip, children }: { tip?: string; headline?: string; cta?: string; href?: string; children?: ReactNode }) {
  if (!tip) return <>{children}</>;
  return (
    <DsTooltip content={tip} contentProps={{ maxWidth: "280px" }}>
      <span tabIndex={0} style={{ textDecoration: "underline dotted", textUnderlineOffset: "3px", cursor: "help" }}>
        {children}
      </span>
    </DsTooltip>
  );
}

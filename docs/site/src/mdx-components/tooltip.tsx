import type { ReactNode } from "react";

export function Tooltip({ tip, children }: { tip?: string; headline?: string; cta?: string; href?: string; children?: ReactNode }) {
  return <span data-mdx="tooltip" title={tip}>{children}</span>;
}

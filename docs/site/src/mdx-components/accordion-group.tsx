import type { ReactNode } from "react";

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return <div data-mdx="accordion-group">{children}</div>;
}

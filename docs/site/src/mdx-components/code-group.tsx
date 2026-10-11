import type { ReactNode } from "react";

export function CodeGroup({ children }: { children?: ReactNode }) {
  return <div data-mdx="code-group">{children}</div>;
}

import type { ReactNode } from "react";

export function Tabs({ children }: { children?: ReactNode }) {
  return <div data-mdx="tabs">{children}</div>;
}

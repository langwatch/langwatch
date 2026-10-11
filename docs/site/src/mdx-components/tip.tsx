import type { ReactNode } from "react";

export function Tip({ children }: { children?: ReactNode }) {
  return (
    <aside data-mdx="callout" data-kind="tip">
      {children}
    </aside>
  );
}

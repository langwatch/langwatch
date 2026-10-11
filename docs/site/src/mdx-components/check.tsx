import type { ReactNode } from "react";

export function Check({ children }: { children?: ReactNode }) {
  return (
    <aside data-mdx="callout" data-kind="check">
      {children}
    </aside>
  );
}

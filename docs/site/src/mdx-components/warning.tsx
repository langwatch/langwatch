import type { ReactNode } from "react";

export function Warning({ children }: { children?: ReactNode }) {
  return (
    <aside data-mdx="callout" data-kind="warning">
      {children}
    </aside>
  );
}

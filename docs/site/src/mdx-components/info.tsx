import type { ReactNode } from "react";

export function Info({ children }: { children?: ReactNode }) {
  return (
    <aside data-mdx="callout" data-kind="info">
      {children}
    </aside>
  );
}

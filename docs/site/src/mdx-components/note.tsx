import type { ReactNode } from "react";

export function Note({ children }: { children?: ReactNode }) {
  return (
    <aside data-mdx="callout" data-kind="note">
      {children}
    </aside>
  );
}

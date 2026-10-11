import type { ReactNode } from "react";

export function Expandable({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <details data-mdx="expandable">
      <summary>{title ?? "Show properties"}</summary>
      {children}
    </details>
  );
}

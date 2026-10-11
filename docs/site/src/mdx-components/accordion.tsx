import type { ReactNode } from "react";

export function Accordion({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <details data-mdx="accordion">
      <summary>{title}</summary>
      {children}
    </details>
  );
}

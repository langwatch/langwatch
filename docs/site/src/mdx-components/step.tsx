import type { ReactNode } from "react";

export function Step({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <li data-mdx="step">
      {title ? <strong>{title}</strong> : null}
      {children}
    </li>
  );
}

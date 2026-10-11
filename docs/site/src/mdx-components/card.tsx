import type { ReactNode } from "react";

export function Card({ title, href, children }: { title?: string; href?: string; icon?: string; children?: ReactNode }) {
  const heading = title ? <strong>{title}</strong> : null;
  return (
    <div data-mdx="card">
      {href ? <a href={href}>{heading}</a> : heading}
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

export function Tab({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section data-mdx="tab">
      {title ? <h4>{title}</h4> : null}
      {children}
    </section>
  );
}

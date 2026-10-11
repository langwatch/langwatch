import type { ReactNode } from "react";

export function CardGroup({ cols, children }: { cols?: number | string; children?: ReactNode }) {
  return <div data-mdx="card-group" data-cols={cols}>{children}</div>;
}

import type { ReactNode } from "react";

export function Steps({ children }: { children?: ReactNode }) {
  return <ol data-mdx="steps">{children}</ol>;
}

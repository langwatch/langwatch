import type { ReactNode } from "react";

export function Frame({ caption, children }: { caption?: string; children?: ReactNode }) {
  return (
    <figure data-mdx="frame">
      {children}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

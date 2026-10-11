import type { ReactNode } from "react";

export function ResponseField({ name, type, required, children }: { name?: string; type?: string; required?: boolean; children?: ReactNode }) {
  return (
    <div data-mdx="response-field">
      <code>{name}</code> {type ? <span>{type}</span> : null} {required ? <span>required</span> : null}
      {children}
    </div>
  );
}

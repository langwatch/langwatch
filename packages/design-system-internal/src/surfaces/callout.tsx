import type { ReactNode } from "react";

export type CalloutProps = {
  children?: ReactNode;
  title?: ReactNode;
  tone?: "info" | "warning" | "error";
};

export const Callout = ({ children, title, tone = "info" }: CalloutProps) => (
  <div className="ds-callout" data-tone={tone} role={tone === "error" ? "alert" : "note"}>
    <span className="ds-callout-mark" aria-hidden="true" />
    <div className="ds-callout-content">
      {title !== undefined && <p className="ds-callout-title">{title}</p>}
      {children !== undefined && <div className="ds-callout-body">{children}</div>}
    </div>
  </div>
);

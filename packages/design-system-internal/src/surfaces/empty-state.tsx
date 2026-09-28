import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** The one next step, usually a primary `Button`. */
  action?: ReactNode;
};

export const EmptyState = ({ title, description, action }: EmptyStateProps) => (
  <div className="ds-empty">
    <p className="ds-empty-title">{title}</p>
    {description !== undefined && <p className="ds-empty-description">{description}</p>}
    {action !== undefined && <div className="ds-empty-action">{action}</div>}
  </div>
);

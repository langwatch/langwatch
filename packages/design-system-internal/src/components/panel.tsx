import { useId, type ReactNode } from "react";

import { flag } from "./class-names.ts";

export type PanelProps = {
  children: ReactNode;
  title?: ReactNode;
  /** Quiet detail beside the title: a count, a port, an age. */
  meta?: ReactNode;
  /** Controls at the header's end; use `size="sm"`. */
  actions?: ReactNode;
  /**
   * Drop the body's padding. Automatic when a Table, List, KeyValue or
   * LogView is the body's only child.
   */
  flush?: boolean;
};

export const Panel = ({ children, title, meta, actions, flush = false }: PanelProps) => {
  const titleId = useId();
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section className="ds-panel" aria-labelledby={title === undefined ? undefined : titleId}>
      {hasHeader && (
        <header className="ds-panel-header">
          <div className="ds-panel-heading">
            {title !== undefined && (
              <h3 className="ds-panel-title" id={titleId}>
                {title}
              </h3>
            )}
            {meta !== undefined && <span className="ds-panel-meta">{meta}</span>}
          </div>
          {actions !== undefined && <div className="ds-panel-actions">{actions}</div>}
        </header>
      )}
      <div className="ds-panel-body" data-flush={flag({ on: flush })}>
        {children}
      </div>
    </section>
  );
};

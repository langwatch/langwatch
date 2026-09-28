import { useId, type ReactNode } from "react";

import { joinClasses } from "./class-names.ts";

export type SectionProps = {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Layout glue from the console's own app.css; never colour or type. */
  className?: string;
};

export const Section = ({ children, title, description, actions, className }: SectionProps) => {
  const titleId = useId();
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section
      className={joinClasses({ names: ["ds-section", className] })}
      aria-labelledby={title === undefined ? undefined : titleId}
    >
      {hasHeader && (
        <header className="ds-section-header">
          <div className="ds-section-heading">
            {title !== undefined && (
              <h2 className="ds-section-title" id={titleId}>
                {title}
              </h2>
            )}
            {description !== undefined && <p className="ds-section-description">{description}</p>}
          </div>
          {actions !== undefined && <div className="ds-section-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
};

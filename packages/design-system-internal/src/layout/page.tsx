import type { ReactNode } from "react";

export type PageProps = {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The site navigation above the frame, full bleed: normally a `TopBar`. */
  nav?: ReactNode;
  /**
   * `full` lifts the 1200px cap, for a log or a wide table; `narrow` is a
   * centred 560px column, for a form or a picker.
   */
  width?: "default" | "full" | "narrow";
};

export const Page = ({ children, title, subtitle, actions, nav, width = "default" }: PageProps) => {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <div className="ds-page">
      {nav}
      <main className="ds-page-frame" data-width={width}>
        {hasHeader && (
          <header className="ds-page-header">
            <div className="ds-page-heading">
              {title !== undefined && <h1 className="ds-page-title">{title}</h1>}
              {subtitle !== undefined && <p className="ds-page-subtitle">{subtitle}</p>}
            </div>
            {actions !== undefined && <div className="ds-page-actions">{actions}</div>}
          </header>
        )}
        {children}
      </main>
    </div>
  );
};

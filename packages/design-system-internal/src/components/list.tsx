import type { ReactNode } from "react";

export type ListProps = { children: ReactNode; label?: string };

export const List = ({ children, label }: ListProps) => (
  <ul className="ds-list" aria-label={label}>
    {children}
  </ul>
);

type ListItemBase = {
  title: ReactNode;
  description?: ReactNode;
  /** Before the title: a `StatusDot`, an icon. */
  leading?: ReactNode;
  /** Quiet detail at the end: an age, a count. */
  meta?: ReactNode;
};

/** A row is either a link as a whole or carries its own actions, never both. */
export type ListItemProps = ListItemBase &
  ({ href: string; actions?: never } | { href?: undefined; actions?: ReactNode });

const RowContent = ({ title, description, leading, meta }: ListItemBase) => (
  <>
    {leading}
    <div className="ds-list-main">
      <span className="ds-list-title">{title}</span>
      {description !== undefined && <span className="ds-list-description">{description}</span>}
    </div>
    {meta !== undefined && <span className="ds-list-meta">{meta}</span>}
  </>
);

export const ListItem = ({ title, description, leading, meta, href, actions }: ListItemProps) => (
  <li className="ds-list-item">
    {href === undefined ? (
      <div className="ds-list-row">
        <RowContent title={title} description={description} leading={leading} meta={meta} />
        {actions !== undefined && <div className="ds-list-actions">{actions}</div>}
      </div>
    ) : (
      <a className="ds-list-row" href={href}>
        <RowContent title={title} description={description} leading={leading} meta={meta} />
      </a>
    )}
  </li>
);

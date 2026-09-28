import type { MouseEvent, ReactNode } from "react";

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
  /** The row open or selected now: `aria-current` and a brand-soft row. */
  current?: boolean;
};

/**
 * A row is a link, a selectable button, or carries its own actions; never two.
 * With both `href` and `onSelect`, a plain click selects in place and a
 * modified click (new tab, new window) keeps the link's own behaviour.
 */
export type ListItemProps = ListItemBase &
  (
    | { href: string; onSelect?: () => void; actions?: never }
    | { href?: undefined; onSelect: () => void; actions?: never }
    | { href?: undefined; onSelect?: undefined; actions?: ReactNode }
  );

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

const isPlainClick = ({ event }: { event: MouseEvent }) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export const ListItem = ({
  title,
  description,
  leading,
  meta,
  current = false,
  href,
  onSelect,
  actions,
}: ListItemProps) => {
  const content = (
    <RowContent title={title} description={description} leading={leading} meta={meta} />
  );
  const row = (() => {
    if (href !== undefined) {
      const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (onSelect === undefined || !isPlainClick({ event })) return;
        event.preventDefault();
        onSelect();
      };
      return (
        <a
          className="ds-list-row"
          href={href}
          aria-current={current ? "page" : undefined}
          onClick={onClick}
        >
          {content}
        </a>
      );
    }
    if (onSelect !== undefined) {
      return (
        <button
          type="button"
          className="ds-list-row"
          aria-current={current || undefined}
          onClick={onSelect}
        >
          {content}
        </button>
      );
    }
    return (
      <div className="ds-list-row" aria-current={current || undefined}>
        {content}
        {actions !== undefined && <div className="ds-list-actions">{actions}</div>}
      </div>
    );
  })();
  return <li className="ds-list-item">{row}</li>;
};

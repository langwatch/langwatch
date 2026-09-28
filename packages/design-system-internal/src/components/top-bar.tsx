import type { ReactNode } from "react";

import { ThemeToggle } from "./theme-toggle.tsx";

export type ConsoleLink = { label: string; href: string; current?: boolean };

export type TopBarProps = {
  /** The console's name, e.g. "haven" or "IdP simulator". */
  name: string;
  /** The worktree's stack slug, shown mono beside the name. */
  slug?: string;
  homeHref?: string;
  /** Links to the other consoles; mark this console's own link `current`. */
  links?: ConsoleLink[];
  actions?: ReactNode;
  themeToggle?: boolean;
};

const Brand = ({ name, slug, homeHref }: Pick<TopBarProps, "name" | "slug" | "homeHref">) => {
  const content = (
    <>
      <span className="ds-topbar-mark" aria-hidden="true" />
      {name}
      {slug !== undefined && (
        <span className="ds-topbar-slug" title={slug}>
          {slug}
        </span>
      )}
    </>
  );
  return homeHref === undefined ? (
    <div className="ds-topbar-brand">{content}</div>
  ) : (
    <a className="ds-topbar-brand" href={homeHref}>
      {content}
    </a>
  );
};

export const TopBar = ({
  name,
  slug,
  homeHref,
  links = [],
  actions,
  themeToggle = true,
}: TopBarProps) => (
  <header className="ds-topbar">
    <div className="ds-topbar-inner">
      <Brand name={name} slug={slug} homeHref={homeHref} />
      {links.length > 0 && (
        <nav className="ds-topbar-nav" aria-label="Consoles">
          {links.map((link) => (
            <a
              key={link.href}
              className="ds-topbar-link"
              href={link.href}
              aria-current={link.current ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
      <div className="ds-topbar-end">
        {actions}
        {themeToggle && <ThemeToggle />}
      </div>
    </div>
  </header>
);

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { tokens } from "../tokens.ts";
import { flag } from "./class-names.ts";
import { ThemeToggle } from "./theme-toggle.tsx";
import { useScrollEdges } from "./use-scroll-edges.ts";

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

/** The width of an edge's fade (`--space-8` in styles.css). */
const FADE = Number.parseFloat(tokens.space[8]);

/** Scrolls the nav, never the page, so the current link sits clear of both fades. */
const revealCurrent = ({ nav }: { nav: HTMLElement }) => {
  const current = nav.querySelector('[aria-current="page"]');
  if (current === null) return;
  const outer = nav.getBoundingClientRect();
  const inner = current.getBoundingClientRect();
  if (inner.right > outer.right - FADE) nav.scrollLeft += inner.right - outer.right + FADE;
  if (inner.left < outer.left + FADE) nav.scrollLeft -= outer.left + FADE - inner.left;
};

/** Scrolls sideways when the links outgrow the bar; a faded edge says there is more. */
const ConsoleNav = ({ links }: { links: ConsoleLink[] }) => {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (ref.current !== null) revealCurrent({ nav: ref.current });
  }, [links]);
  const edges = useScrollEdges({ ref, axis: "x", watch: links });
  return (
    <nav
      ref={ref}
      className="ds-topbar-nav"
      aria-label="Consoles"
      data-more-start={flag({ on: edges.start })}
      data-more-end={flag({ on: edges.end })}
    >
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
      {links.length > 0 && <ConsoleNav links={links} />}
      <div className="ds-topbar-end">
        {actions}
        {themeToggle && <ThemeToggle />}
      </div>
    </div>
  </header>
);

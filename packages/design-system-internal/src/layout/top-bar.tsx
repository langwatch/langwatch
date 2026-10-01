import { useLayoutEffect, useRef, type ReactNode } from "react";

import { flag } from "../class-names.ts";
import { Menu } from "../overlays/menu.tsx";
import { useScrollEdges } from "../surfaces/use-scroll-edges.ts";
import { ThemeToggle } from "../theme/theme-toggle.tsx";
import { tokens } from "../tokens.ts";

/** A link with a `group` sits in that group's menu ("Sims", "Tools"), not flat in the bar. */
export type ConsoleLink = { label: string; href: string; current?: boolean; group?: string };

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

/** One menu per group; its trigger names the link this page is on, e.g. "Sims · Voice". */
const ConsoleMenu = ({ group, links }: { group: string; links: ConsoleLink[] }) => {
  const current = links.find((link) => link.current);
  return (
    <div className="ds-topbar-group" data-current={flag({ on: current !== undefined })}>
      <Menu
        label={current === undefined ? group : `${group} · ${current.label}`}
        align="end"
        size="sm"
        items={links.map(({ label, href }) => ({
          label,
          onSelect: () => window.location.assign(href),
        }))}
      />
    </div>
  );
};

const groupsOf = ({ links }: { links: ConsoleLink[] }) => {
  const groups = new Map<string, ConsoleLink[]>();
  for (const link of links) {
    if (link.group !== undefined) groups.set(link.group, [...(groups.get(link.group) ?? []), link]);
  }
  return [...groups];
};

/**
 * Flat links scroll sideways when they outgrow the bar (a faded edge says there
 * is more); the menus sit outside the scroller, so their lists are never clipped.
 */
const ConsoleNav = ({ links }: { links: ConsoleLink[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current !== null) revealCurrent({ nav: ref.current });
  }, [links]);
  const edges = useScrollEdges({ ref, axis: "x", watch: links });
  const flat = links.filter((link) => link.group === undefined);
  return (
    <nav className="ds-topbar-nav" aria-label="Consoles">
      <div
        ref={ref}
        className="ds-topbar-scroll"
        data-more-start={flag({ on: edges.start })}
        data-more-end={flag({ on: edges.end })}
      >
        {flat.map((link) => (
          <a
            key={link.href}
            className="ds-topbar-link"
            href={link.href}
            aria-current={link.current ? "page" : undefined}
          >
            {link.label}
          </a>
        ))}
      </div>
      {groupsOf({ links }).map(([group, members]) => (
        <ConsoleMenu key={group} group={group} links={members} />
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

import { LOGO_LINES_PATH } from "@langwatch/design-system/logo-paths";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { pagePath } from "../../../lib/site-path.ts";
import type { NotFoundIndex } from "../model/not-found.ts";
import { Castle } from "./castle.tsx";

/* The static 404: the castle and three starting points, readable without scripts. With scripts,
   the mark draws itself until the 404 island has picked the scene for the missing address's
   section, then flies to that scene's mark (`browser/not-found-intro.ts`). */
const STARTING_POINTS = [
  { slug: "integration/quick-start", title: "Quick Start" },
  { slug: "skills/directory", title: "Skills Directory" },
  { slug: "api-reference/introduction", title: "API Reference" },
];

export const REPORT_ISSUE = "/issues/new";

export function Picks({
  pages,
  label,
}: {
  pages: { slug: string; title: string }[];
  label: string;
}) {
  return (
    <ol className="docs-nf-picks" aria-label={label}>
      {pages.map((page, index) => {
        const href = pagePath({ slug: page.slug });
        return (
          <li key={page.slug}>
            <a href={href} data-nf-pick={index + 1}>
              <span className="docs-nf-num">{index + 1}</span>
              <span className="docs-nf-title">{page.title}</span>
              <span className="docs-nf-where">{href}</span>
              <span className="docs-nf-go">
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export function NotFoundPage({ title, index }: { title: string; index: NotFoundIndex }) {
  return (
    <div
      className="docs-nf"
      data-docs-not-found=""
      data-scene="other"
      data-docs-not-found-index={JSON.stringify(index)}
    >
      <header className="docs-nf-head">
        <p className="docs-path docs-nf-path">
          <span className="docs-nf-dot" aria-hidden="true" />
          404
          <span className="docs-path-sep" aria-hidden="true">
            /
          </span>
          <span data-nf-section="">Docs</span>
        </p>
        <h1>{title}</h1>
        <p className="docs-nf-address">
          There is no page at <code data-nf-address="">this address</code>. The link may be broken,
          or the page may have moved.
        </p>
      </header>
      <div className="docs-nf-scene">
        <div className="docs-nf-intro" data-nf-intro="" aria-hidden="true">
          <svg viewBox="0 0 38 52" width="74" height="101">
            <path d={LOGO_LINES_PATH} pathLength={1} />
          </svg>
          <p>
            finding the page<span>_</span>
          </p>
        </div>
        <div className="docs-nf-stage" data-nf-stage="">
          <Castle />
          <nav className="docs-nf-fix" aria-label="Suggested pages">
            <p className="docs-nf-fix-head">
              <strong>Try one of these instead</strong>
              <span className="docs-nf-dim">Nearby pages, or good places to start.</span>
            </p>
            <Picks pages={STARTING_POINTS} label="Starting points" />
          </nav>
          <p className="docs-nf-keys">Press 1 to 3 to open a page, or / to search the docs.</p>
        </div>
      </div>
    </div>
  );
}

export function NotFoundRail({ github, note }: { github: string; note: ReactNode }) {
  const links = [
    { slug: "integration/quick-start", title: "Quick Start" },
    { slug: "skills/directory", title: "Skills Directory" },
    { slug: "api-reference/introduction", title: "API Reference" },
    { slug: "changelog", title: "Changelog" },
    { slug: "support", title: "Get Support" },
  ];
  return (
    <nav className="docs-nf-rail" aria-label="Find your way">
      <div data-nf-matches="" hidden>
        <h2>Closest matches</h2>
        <ul data-nf-rail-matches="" />
      </div>
      <h2>Find your way</h2>
      <ul>
        <li>
          <button type="button" data-docs-search="" data-docs-search-query="" data-nf-search="">
            Search the docs <kbd>⌘K</kbd>
          </button>
        </li>
        {links.map((link) => (
          <li key={link.slug}>
            <a href={pagePath({ slug: link.slug })}>{link.title}</a>
          </li>
        ))}
        <li>
          <a
            data-nf-report=""
            href={`${github}${REPORT_ISSUE}?title=${encodeURIComponent("Broken docs link")}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a broken link
          </a>
        </li>
      </ul>
      {note ? <p className="docs-nf-note">{note}</p> : null}
    </nav>
  );
}

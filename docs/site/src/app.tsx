import { MDXProvider } from "@mdx-js/react";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import nav from "virtual:docs-nav";
import type { NavItem } from "virtual:docs-nav";
import { mdxComponents } from "./mdx-components/index.ts";
import type { PageModule } from "./pages.ts";

function NavTree({ items, current }: { items: NavItem[]; current: string }) {
  return (
    <ul>
      {items.map((item) =>
        item.type === "page" ? (
          <li key={item.slug}>
            <a href={`/${item.slug}`} aria-current={item.slug === current ? "page" : undefined}>
              {item.title}
            </a>
          </li>
        ) : (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <NavTree items={item.children} current={current} />
          </li>
        ),
      )}
    </ul>
  );
}

function ownsSlug({ items, slug }: { items: NavItem[]; slug: string }): boolean {
  return items.some((item) => (item.type === "page" ? item.slug === slug : ownsSlug({ items: item.children, slug })));
}

export function App({ slug, page }: { slug: string; page: PageModule | null }) {
  const meta = nav.pages[slug];
  const active = nav.anchors.find((anchor) => ownsSlug({ items: anchor.children, slug })) ?? nav.anchors[0];
  const Content = page?.default;
  return (
    <DesignSystemProvider>
      <MDXProvider components={mdxComponents}>
        <header>
          <a href="/">LangWatch docs</a>
          <nav>
            {nav.anchors.map((anchor) => (
              <a key={anchor.title} href={`/${firstSlug({ items: anchor.children })}`}>
                {anchor.title}
              </a>
            ))}
          </nav>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 220px", gap: 24 }}>
          <aside>{active ? <NavTree items={active.children} current={slug} /> : null}</aside>
          <main>
            {Content && meta ? (
              <article>
                <h1>{meta.title}</h1>
                {meta.description ? <p>{meta.description}</p> : null}
                {meta.openapi ? <pre data-mdx="openapi">{meta.openapi}</pre> : null}
                <Content />
              </article>
            ) : (
              <h1>Page not found</h1>
            )}
          </main>
          <aside>On this page</aside>
        </div>
      </MDXProvider>
    </DesignSystemProvider>
  );
}

function firstSlug({ items }: { items: NavItem[] }): string {
  for (const item of items) {
    if (item.type === "page") return item.slug;
    const found = firstSlug({ items: item.children });
    if (found) return found;
  }
  return "";
}

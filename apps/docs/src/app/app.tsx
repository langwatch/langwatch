import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { createDesignSystem } from "@langwatch/design-system/system";
import { MDXProvider } from "@mdx-js/react";
import nav from "virtual:docs-nav";

import type { HighlightedExamples, Operation } from "../features/api-reference/model.ts";
import {
  EndpointReference,
  EndpointStateProvider,
  EndpointSummary,
  Playground,
} from "../features/api-reference/ui.ts";
import { mdxComponents } from "../features/content/ui.ts";
import { notFoundIndex } from "../features/navigation/model.ts";
import { NotFoundPage, NotFoundRail } from "../features/navigation/ui.ts";
import { DocsShell, InlineContent } from "../features/shell/ui.ts";
import { TypeRegion } from "../lib/type-mode.tsx";
import type { PageModule } from "./pages.ts";
import { docsTheme } from "./theme-config.ts";

import "./docs.css";

/** The page list the 404 island matches a missing address against. */
const notFoundPages = notFoundIndex({ sections: nav.anchors, pages: nav.pages });

/** Every recipe, for the prerender; no browser island loads the design system. */
const docsSystem = createDesignSystem(docsTheme);

export type AppProps = {
  slug: string;
  page: PageModule | null;
  operation: Operation | null;
  examples?: HighlightedExamples;
};

export function App({ slug, page, operation, examples }: AppProps) {
  return (
    <DesignSystemProvider system={docsSystem}>
      <MDXProvider components={mdxComponents}>
        <PageContent slug={slug} page={page} operation={operation} examples={examples} />
      </MDXProvider>
    </DesignSystemProvider>
  );
}

function PageContent({ slug, page, operation, examples }: AppProps) {
  const meta = nav.pages[slug];
  const Content = page?.default;
  const toc = operation
    ? [
        ...(operation.schemes.length
          ? [{ depth: 2, text: "Authorization", id: "authorization" }]
          : []),
        ...[
          { location: "path", text: "Path parameters" },
          { location: "query", text: "Query parameters" },
          { location: "header", text: "Headers" },
        ]
          .filter(({ location }) =>
            operation.parameters.some((parameter) => parameter.in === location),
          )
          .map(({ text }) => ({ depth: 2, text, id: text.toLowerCase().replaceAll(" ", "-") })),
        ...(operation.body ? [{ depth: 2, text: "Request body", id: "request-body" }] : []),
        { depth: 2, text: "Responses", id: "responses" },
        ...(page?.headings ?? []),
      ]
    : (page?.headings ?? []);
  if (!Content || !meta) return <NotFound />;
  if (operation)
    return (
      <EndpointStateProvider operation={operation}>
        <DocsShell
          slug={slug}
          kind="endpoint"
          title={meta.title}
          description={meta.description || operation.description}
          toc={toc}
          updated={meta.updated}
          tag={meta.tag}
          endpoint={{
            summary: <EndpointSummary operation={operation} />,
            playground: (
              <TypeRegion mode="productive">
                <Playground operation={operation} highlighted={examples} slug={slug} />
              </TypeRegion>
            ),
            reference: (
              <EndpointReference operation={operation}>
                <Content />
              </EndpointReference>
            ),
          }}
        />
      </EndpointStateProvider>
    );
  return (
    <DocsShell
      slug={slug}
      kind={slug === "introduction" ? "home" : "guide"}
      title={meta.title}
      description={meta.description}
      toc={toc}
      wide={meta.mode === "wide"}
      updated={meta.updated}
      tag={meta.tag}
    >
      <Content />
    </DocsShell>
  );
}

function NotFound() {
  return (
    <DocsShell
      slug="404"
      kind="guide"
      title={nav.site.notFound.title}
      description=""
      toc={[]}
      aside={
        <NotFoundRail
          github={nav.site.github}
          note={<InlineContent nodes={nav.site.notFound.content} />}
        />
      }
    >
      <NotFoundPage title={nav.site.notFound.title} index={notFoundPages} />
    </DocsShell>
  );
}

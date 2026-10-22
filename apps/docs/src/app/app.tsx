import { Box, Button, Text } from "@langwatch/design-system/primitives";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { createDesignSystem } from "@langwatch/design-system/system";
import { MDXProvider } from "@mdx-js/react";
import { Search } from "lucide-react";
import nav from "virtual:docs-nav";

import type { HighlightedExamples, Operation } from "../features/api-reference/model/operation.ts";
import { EndpointStateProvider } from "../features/api-reference/ui/endpoint-state.tsx";
import { Playground } from "../features/api-reference/ui/playground.tsx";
import { EndpointReference, EndpointSummary } from "../features/api-reference/ui/reference.tsx";
import { Card, CardGroup } from "../features/content/ui/cards.tsx";
import { mdxComponents } from "../features/content/ui/mdx-components.ts";
import { InlineContent } from "../features/shell/ui/inline-content.tsx";
import { DocsShell } from "../features/shell/ui/shell.tsx";
import { TypeRegion } from "../lib/type-mode.tsx";
import type { PageModule } from "./pages.ts";
import { docsTheme } from "./theme-config.ts";

import "./docs.css";

/** Every recipe, for the prerender; each browser island selects its own (`island-theme.ts`). */
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
          ? [{ depth: 2, text: "Authorisation", id: "authorisation" }]
          : []),
        ...[
          ["path", "Path parameters"],
          ["query", "Query parameters"],
          ["header", "Headers"],
        ]
          .filter(([location]) =>
            operation.parameters.some((parameter) => parameter.in === location),
          )
          .map(([, text]) => ({ depth: 2, text, id: text.toLowerCase().replaceAll(" ", "-") })),
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
      description={
        nav.site.notFound.content.length
          ? ""
          : "This page may have moved. Search the docs or choose a starting point below."
      }
      toc={[]}
    >
      <Box paddingBottom="12">
        {nav.site.notFound.content.length ? (
          <Text data-docs-not-found-copy="" marginTop="0" marginBottom="6" color="docs.lede">
            <InlineContent nodes={nav.site.notFound.content} />
          </Text>
        ) : null}
        <Button
          data-docs-search=""
          variant="outline"
          colorPalette="gray"
          height="44px"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
          }
        >
          <Search size={16} /> Search the docs
        </Button>
        <h2 className="docs-sr-only">Starting points</h2>
        <CardGroup cols={3}>
          <Card
            title="Quick Start"
            description="Send your first trace."
            href="/integration/quick-start"
            icon="rocket"
          />
          <Card
            title="Skills Directory"
            description="Set up with your coding assistant."
            href="/skills/directory"
            icon="terminal"
          />
          <Card
            title="API Reference"
            description="Explore endpoints and try a request."
            href="/api-reference/introduction"
            icon="code"
          />
        </CardGroup>
      </Box>
    </DocsShell>
  );
}

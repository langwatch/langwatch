import { Box, Button } from "@langwatch/design-system/primitives";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { MDXProvider } from "@mdx-js/react";
import { Search } from "lucide-react";
import nav from "virtual:docs-nav";

import { EndpointStateProvider } from "./api/endpoint-state.tsx";
import type { HighlightedExamples, Operation } from "./api/operation.ts";
import { Playground } from "./api/playground.tsx";
import { EndpointReference, EndpointSummary } from "./api/reference.tsx";
import { TypeRegion } from "./lib/type-mode.tsx";
import { Card, CardGroup } from "./mdx-components/cards.tsx";
import { mdxComponents } from "./mdx-components/index.ts";
import type { PageModule } from "./pages.ts";
import { DocsShell } from "./shell/shell.tsx";
import { docsSystem } from "./theme.ts";

import "./docs.css";

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
      description="This page may have moved. Search the docs or choose a starting point below."
      toc={[]}
    >
      <Box paddingBottom="12">
        <Button
          variant="outline"
          colorPalette="gray"
          height="44px"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
          }
        >
          <Search size={16} /> Search the docs
        </Button>
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

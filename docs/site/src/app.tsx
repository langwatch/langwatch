import { Box, Heading, Link, Text } from "@langwatch/design-system/primitives";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { MDXProvider } from "@mdx-js/react";
import nav from "virtual:docs-nav";

import { EndpointStateProvider } from "./api/endpoint-state.tsx";
import type { HighlightedExamples, Operation } from "./api/operation.ts";
import { Playground } from "./api/playground.tsx";
import { EndpointReference, EndpointSummary } from "./api/reference.tsx";
import { TypeRegion } from "./lib/type-mode.tsx";
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
  const meta = nav.pages[slug];
  const Content = page?.default;
  const toc = page?.headings ?? [];
  return (
    <DesignSystemProvider system={docsSystem}>
      <MDXProvider components={mdxComponents}>
        {Content && meta ? (
          operation ? (
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
          ) : (
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
          )
        ) : (
          <NotFound />
        )}
      </MDXProvider>
    </DesignSystemProvider>
  );
}

function NotFound() {
  return (
    <Box maxWidth="40rem" marginX="auto" padding="8" paddingTop="24">
      <Heading as="h1" fontSize="30px" lineHeight="38px" margin="0">
        {nav.site.notFound.title}
      </Heading>
      <Text marginTop="4" color="fg.muted" fontSize="18px" lineHeight="28px">
        Search above for what you were looking for, or start from the{" "}
        <Link href="/introduction" color="blue.fg" textDecoration="underline">
          introduction
        </Link>
        . If a link on our own site sent you here,{" "}
        <Link href="/support" color="blue.fg" textDecoration="underline">
          tell us
        </Link>{" "}
        so we can fix it.
      </Text>
    </Box>
  );
}

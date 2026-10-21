import { Box } from "@langwatch/design-system/primitives";
import { useState } from "react";
import type { ReactNode } from "react";

import { TypeRegion } from "../../../lib/type-mode.tsx";
import type { TypeMode } from "../../../lib/type-mode.tsx";
import { neighbours, trailOf } from "../../navigation/model/nav.ts";
import { MobileNav } from "../../navigation/ui/mobile-nav.tsx";
import { SideNav } from "../../navigation/ui/side-nav.tsx";
import { sectionOf } from "../../navigation/ui/site-nav.ts";
import { SiteBanner } from "../../releases/ui/banner.tsx";
import { Header, HEADER_HEIGHT, type PageKind } from "./header.tsx";
import { PageFooter } from "./page-footer.tsx";
import { PageHeader } from "./page-header.tsx";
import { SiteFooter } from "./site-footer.tsx";
import { TocDisclosure, TocRail } from "./toc.tsx";
import type { TocEntry } from "./toc.tsx";

const ENDPOINT_QUERY = "@media (min-width: 80rem)";

type ShellProps = {
  slug: string;
  kind: PageKind;
  title: string;
  description: string;
  toc: TocEntry[];
  children?: ReactNode;
  typeMode?: TypeMode;
  wide?: boolean;
  endpoint?: { summary: ReactNode; playground: ReactNode; reference: ReactNode };
};

function LeftRail({ children }: { children: ReactNode }) {
  return (
    <Box
      className="docs-nav-plane"
      gridArea="nav"
      display={{ base: "none", lg: "block" }}
      position="relative"
      zIndex="0"
    >
      <Box
        className="docs-left-rail"
        data-docs-rail=""
        display="flex"
        flexDirection="column"
        paddingTop="6"
        paddingBottom="10"
        paddingX="4"
      >
        {children}
      </Box>
    </Box>
  );
}

export function DocsShell({
  slug,
  kind,
  title,
  description,
  toc,
  children,
  endpoint,
  typeMode = "expressive",
  wide = false,
}: ShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const section = sectionOf({ slug });
  const trail = section ? (trailOf({ items: section.children, slug }) ?? []) : [];
  const breadcrumb = [section?.title ?? "Docs", ...trail.slice(-1)];
  const { previous, next } = neighbours({ section, slug });
  const showRail = kind !== "endpoint" && toc.length >= 2;
  const header = (
    <PageHeader
      slug={slug}
      title={title}
      description={description}
      breadcrumb={breadcrumb}
      kind={kind}
    />
  );
  const contents = kind !== "endpoint" && toc.length >= 2 ? <TocDisclosure entries={toc} /> : null;
  const footer = slug === "404" ? null : <PageFooter slug={slug} previous={previous} next={next} />;

  return (
    <Box
      className="docs-shell"
      minHeight="100vh"
      bg="transparent"
      color="fg"
      position="relative"
      isolation="isolate"
      css={{
        "--docs-header-h": HEADER_HEIGHT.base,
        "@media (min-width: 64rem)": { "--docs-header-h": HEADER_HEIGHT.lg },
        overflowX: "clip",
      }}
    >
      <a className="docs-skip-link" href="#content">
        Skip to content
      </a>
      {section ? (
        <a className="docs-skip-link" href="#page-tree">
          Skip to page list
        </a>
      ) : null}
      <SiteBanner />
      <Header kind={kind} onMenu={() => setMenuOpen(true)} />
      <Box
        className="docs-layout"
        data-kind={kind}
        data-has-toc={showRail ? "true" : "false"}
        data-wide={wide || !showRail ? "true" : "false"}
      >
        <LeftRail>
          <SideNav active={section} slug={slug} treeId="page-tree" />
        </LeftRail>
        {endpoint ? (
          <>
            <Box
              id="content"
              as="main"
              tabIndex={-1}
              gridArea={{ base: "main", lg: "main" }}
              minWidth="0"
              maxWidth="none"
              marginX="0"
              width="100%"
              paddingBottom="12"
              css={{ [ENDPOINT_QUERY]: { display: "contents" } }}
            >
              <Box
                className="docs-endpoint-top"
                css={{ [ENDPOINT_QUERY]: { gridArea: "top", minWidth: 0 } }}
              >
                {header}
                {endpoint.summary}
                {contents ? <Box marginTop="6">{contents}</Box> : null}
              </Box>
              <Box
                className="docs-endpoint-play"
                marginY="6"
                css={{
                  [ENDPOINT_QUERY]: {
                    gridArea: "play",
                    marginTop: 0,
                    marginInlineStart: "0",
                    alignSelf: "start",
                    marginBlock: "3rem 0",
                  },
                }}
              >
                {endpoint.playground}
              </Box>
              <Box
                className="docs-endpoint-ref"
                css={{ [ENDPOINT_QUERY]: { gridArea: "ref", minWidth: 0 } }}
              >
                {endpoint.reference}
                {footer}
              </Box>
            </Box>
          </>
        ) : (
          <Box
            id="content"
            as="main"
            tabIndex={-1}
            gridArea="main"
            minWidth="0"
            width="100%"
            maxWidth="none"
            marginX={{ base: "auto", lg: "0" }}
            paddingBottom="12"
          >
            {header}
            {kind === "guide" ? <Box marginTop="4">{contents}</Box> : null}
            <TypeRegion
              mode={typeMode}
              as="article"
              className="docs-prose"
              marginTop={{ base: "8", xl: "10" }}
            >
              {children}
            </TypeRegion>
            {footer}
          </Box>
        )}
        {showRail ? (
          <Box gridArea="toc" paddingTop="0" display={{ base: "none", xl: "block" }}>
            <Box className="docs-toc-container" data-docs-rail="" paddingTop="10" paddingBottom="6">
              <TocRail entries={toc} />
            </Box>
          </Box>
        ) : null}
      </Box>
      <SiteFooter />
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} active={section} slug={slug} />
    </Box>
  );
}

import { Box } from "@langwatch/design-system/primitives";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { neighbours, sectionOf, trailOf } from "../lib/nav-model.ts";
import { TypeRegion } from "../lib/type-mode.tsx";
import type { TypeMode } from "../lib/type-mode.tsx";
import { SiteBanner } from "./banner.tsx";
import { PageGround } from "./ground.tsx";
import { Header } from "./header.tsx";
import { ENDPOINT_QUERY, HEADER_HEIGHT, STICKY_TOP } from "./layout.ts";
import type { PageKind } from "./layout.ts";
import { MobileNav } from "./mobile-nav.tsx";
import { PageFooter } from "./page-footer.tsx";
import { PageHeader } from "./page-header.tsx";
import { SearchDialog, useSearchShortcut } from "./search.tsx";
import { SideNav } from "./side-nav.tsx";
import { TocDisclosure, TocRail } from "./toc.tsx";
import type { TocEntry } from "./toc.tsx";

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
    <Box gridArea="nav" display={{ base: "none", lg: "block" }} position="relative" zIndex="0">
      <Box
        className="docs-left-rail"
        position="sticky"
        top="var(--docs-header-h)"
        height="calc(100vh - var(--docs-header-h))"
        display="flex"
        flexDirection="column"
        overflowY="auto"
        paddingTop="6"
        paddingBottom="10"
        paddingInlineEnd="0"
        css={{ scrollbarWidth: "thin" }}
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useSearchShortcut({ onOpen: openSearch });
  const section = sectionOf({ slug });
  const trail = section ? (trailOf({ items: section.children, slug }) ?? []) : [];
  const breadcrumb = [section?.title ?? "Docs", ...trail.slice(-1)];
  const { previous, next } = neighbours({ section, slug });
  const showRail = kind === "guide" && !wide && toc.length >= 2;
  const header = (
    <PageHeader
      slug={slug}
      title={title}
      description={description}
      breadcrumb={breadcrumb}
      kind={kind}
    />
  );
  const contents =
    toc.length >= 2 ? <TocDisclosure entries={toc} always={kind === "endpoint"} /> : null;
  const footer = <PageFooter slug={slug} previous={previous} next={next} />;

  return (
    <Box
      className="docs-shell"
      minHeight="100vh"
      bg={{ base: "docs.paper", lg: "docs.canvas" }}
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
      <a className="docs-skip-link" href="#page-tree">
        Skip to page list
      </a>
      <PageGround home={kind === "home"} />
      <SiteBanner />
      <Header kind={kind} onSearch={openSearch} onMenu={() => setMenuOpen(true)} />
      <Box
        className="docs-layout"
        data-kind={kind}
        data-wide={wide || kind === "home" || !showRail ? "true" : "false"}
      >
        <LeftRail>
          <SideNav active={section} slug={slug} treeId="page-tree" scrollTree />
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
                    position: "sticky",
                    top: STICKY_TOP,
                    alignSelf: "start",
                    maxHeight: "calc(100vh - var(--docs-header-h) - 3rem)",
                    overflowY: "auto",
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
            {kind === "guide" && !wide ? <Box>{contents}</Box> : null}
            <TypeRegion
              mode={typeMode}
              as="article"
              className="docs-prose"
              marginTop={{ base: "8", xl: "12" }}
            >
              {children}
            </TypeRegion>
            {footer}
          </Box>
        )}
        {showRail ? (
          <Box gridArea="toc" paddingTop="12" display={{ base: "none", xl: "block" }}>
            <Box
              position="sticky"
              top={STICKY_TOP}
              maxHeight="calc(100vh - var(--docs-header-h) - 3rem)"
              overflowY="auto"
              paddingTop="0"
            >
              <TocRail entries={toc} />
            </Box>
          </Box>
        ) : null}
      </Box>
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} active={section} slug={slug} />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Box>
  );
}

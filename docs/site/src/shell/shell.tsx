import { Box } from "@langwatch/design-system/primitives";
import { TypeRegion } from "../lib/type-mode.tsx";
import type { TypeMode } from "../lib/type-mode.tsx";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { neighbours, sectionOf, trailOf } from "../lib/nav-model.ts";
import { SiteBanner } from "./banner.tsx";
import { Header } from "./header.tsx";
import { ENDPOINT_QUERY, FRAME_MAX, GUTTER, HEADER_HEIGHT, NAV_WIDTH, STICKY_TOP } from "./layout.ts";
import type { PageKind } from "./layout.ts";
import { MobileNav } from "./mobile-nav.tsx";
import { PageFooter } from "./page-footer.tsx";
import { PageHeader } from "./page-header.tsx";
import { SearchDialog, useSearchShortcut } from "./search.tsx";
import { TocDisclosure, TocRail } from "./toc.tsx";
import type { TocEntry } from "./toc.tsx";
import { PageGround } from "./ground.tsx";
import { SideNav } from "./side-nav.tsx";

type ShellProps = {
  slug: string;
  kind: PageKind;
  title: string;
  description: string;
  toc: TocEntry[];
  children?: ReactNode;
  typeMode?: TypeMode;
  endpoint?: { summary: ReactNode; playground: ReactNode; reference: ReactNode };
};

function LeftRail({ children }: { children: ReactNode }) {
  return (
    <Box gridArea="nav" display={{ base: "none", lg: "block" }} position="relative" zIndex="0">
      <Box
        position="sticky"
        top="var(--docs-header-h)"
        maxHeight="calc(100vh - var(--docs-header-h))"
        overflowY="auto"
        data-docs-scroll=""
        paddingTop="6"
        paddingBottom="10"
        paddingInlineEnd="3"
        css={{ scrollbarWidth: "thin" }}
      >
        {children}
      </Box>
    </Box>
  );
}

export function DocsShell({ slug, kind, title, description, toc, children, endpoint, typeMode = "expressive" }: ShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useSearchShortcut({ onOpen: openSearch });
  const section = sectionOf({ slug });
  const trail = section ? (trailOf({ items: section.children, slug }) ?? []) : [];
  const breadcrumb = [section?.title ?? "Docs", ...trail.slice(-1)];
  const { previous, next } = neighbours({ section, slug });
  const showRail = kind === "guide" && toc.length >= 2;
  const header = <PageHeader slug={slug} title={title} description={description} breadcrumb={breadcrumb} kind={kind} />;
  const contents = toc.length >= 2 ? <TocDisclosure entries={toc} always={kind === "endpoint"} /> : null;
  const footer = <PageFooter slug={slug} previous={previous} next={next} />;

  const areas = kind === "guide" ? { base: '"main"', lg: '"nav main"', xl: '"nav main toc"' } : { base: '"main"', lg: '"nav main"' };
  const columns = {
    base: "minmax(0, 1fr)",
    lg: `${NAV_WIDTH.lg} minmax(0, ${kind === "home" ? "60rem" : "45rem"})`,
    xl: kind === "guide" ? `${NAV_WIDTH.xl} minmax(0, 45rem) 11.5rem` : `${NAV_WIDTH.xl} minmax(0, ${kind === "home" ? "60rem" : "45rem"})`,
  };

  return (
    <Box
      minHeight="100vh"
      bg="bg.surface"
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
      {kind === "endpoint" ? null : <PageGround />}
      <SiteBanner />
      <Header kind={kind} onSearch={openSearch} onMenu={() => setMenuOpen(true)} />
      <Box
        display="grid"
        maxWidth={FRAME_MAX[kind]}
        marginX="auto"
        paddingX={GUTTER}
        gridTemplateColumns={columns}
        gridTemplateAreas={areas}
        columnGap={{ base: "0", lg: "8", xl: "10" }}
        justifyContent="center"
        position="relative"
        zIndex="1"
        css={kind === "endpoint" ? { [ENDPOINT_QUERY]: { gridTemplateColumns: `${NAV_WIDTH.xl} minmax(0, 40rem) 26rem`, gridTemplateAreas: '"nav top play" "nav ref play"', columnGap: "2rem" } } : undefined}
      >
        <LeftRail>
          <SideNav active={section} slug={slug} treeId="page-tree" />
        </LeftRail>
        {endpoint ? (
          <>
            <Box id="content" as="main" tabIndex={-1} gridArea={{ base: "main", lg: "main" }} minWidth="0" maxWidth="45rem" marginX="0" width="100%" paddingBottom="12" css={{ [ENDPOINT_QUERY]: { display: "contents" } }}>
              <Box className="docs-endpoint-top" css={{ [ENDPOINT_QUERY]: { gridArea: "top", minWidth: 0 } }}>
                {header}
                {endpoint.summary}
                <Box marginTop="6">{contents}</Box>
              </Box>
              <Box
                className="docs-endpoint-play"
                marginY="6"
                css={{
                  [ENDPOINT_QUERY]: { gridArea: "play", marginTop: 0, marginInlineStart: "-0.5rem", position: "sticky", top: STICKY_TOP, alignSelf: "start", maxHeight: "calc(100vh - var(--docs-header-h) - 3rem)", overflowY: "auto", marginBlock: "3rem 0" },
                }}
              >
                {endpoint.playground}
              </Box>
              <Box className="docs-endpoint-ref" css={{ [ENDPOINT_QUERY]: { gridArea: "ref", minWidth: 0 } }}>
                {endpoint.reference}
                {footer}
              </Box>
            </Box>
          </>
        ) : (
          <Box id="content" as="main" tabIndex={-1} gridArea="main" minWidth="0" width="100%" maxWidth={kind === "home" ? { base: "60rem" } : "45rem"} marginX={{ base: "auto", lg: "0" }} paddingBottom="12">
            {header}
            {kind === "guide" ? <Box marginTop="6">{contents}</Box> : null}
            <TypeRegion mode={typeMode} as="article" className="docs-prose" marginTop={{ base: "6", md: "8" }}>
              {children}
            </TypeRegion>
            {footer}
          </Box>
        )}
        {showRail ? (
          <Box gridArea="toc" display={{ base: "none", xl: "block" }}>
            <Box position="sticky" top={STICKY_TOP} maxHeight="calc(100vh - var(--docs-header-h) - 3rem)" overflowY="auto" paddingTop="12">
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

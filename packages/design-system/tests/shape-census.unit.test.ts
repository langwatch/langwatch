import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CensusSite,
  type Escape,
  censusSites,
  driftKind,
  evaluateCheck,
  exitCodeOf,
  gateRefusal,
  loadEscapes,
  matchesPath,
  openOwners,
  summariseCensus,
  targetApi,
} from "../.storybook/census.ts";

const file = "modules/example/browser/src/ui/example.tsx";
const sitesOf = (source: string, at = file) => censusSites({ file: at, source }).sites;
const imports = {
  primitives: (names: string) => `import { ${names} } from "@langwatch/design-system/primitives";`,
  drawer: 'import { Drawer } from "@langwatch/design-system/drawer";',
};
const where = (sites: CensusSite[], rule: string) => sites.filter((site) => site.rule === rule);

describe("shape census classifier", () => {
  it("counts a bordered, rounded Box as a hand-built card", () => {
    const sites = sitesOf(`
      import { Box } from "@langwatch/design-system/primitives";
      export const Tile = () => (
        <Box
          borderWidth="1px"
          borderRadius="md"
          padding={4}
        >
          Body
        </Box>
      );
    `);
    expect(sites).toEqual([
      expect.objectContaining({
        family: "cards",
        kind: "lookalike",
        what: "card-box",
        line: 4,
        props: { borderWidth: "1px", borderRadius: "md", padding: "4" },
      }),
    ]);
  });

  it("leaves a pill and an alert box out of the cards", () => {
    const sites = sitesOf(`
      import { Box } from "@langwatch/design-system/primitives";
      export const Pill = () => <Box borderWidth="1px" borderRadius="full" />;
      export const Warning = () => <Box role="alert" borderWidth="1px" borderRadius="md" />;
    `);
    expect(sites).toEqual([]);
  });

  /** @scenario "A shape site is a clean design-system use, a restyled one or a hand-built look-alike" */
  it("reads overrides on Drawer.Content across lines, and the Root size apart", () => {
    const sites = sitesOf(`
      import { Drawer } from "@langwatch/design-system/drawer";
      export const Edit = () => (
        <Drawer.Root size="md">
          <Drawer.Content
            maxWidth="600px"
            padding={4}
          />
        </Drawer.Root>
      );
    `);
    expect(sites).toEqual([
      expect.objectContaining({ what: "Drawer.Root", site: true, props: { "Root.size": "md" } }),
      expect.objectContaining({
        family: "drawers",
        kind: "ds",
        what: "Drawer.Content",
        site: false,
        props: { maxWidth: "600px", padding: "4" },
      }),
    ]);
  });

  it("counts a raw h1 Heading as a page title, but not one inside PageLayout.Header", () => {
    const sites = sitesOf(`
      import { Heading } from "@langwatch/design-system/primitives";
      import { PageLayout } from "@langwatch/design-system/page-layout";
      export const Loose = () => <Heading as="h1">Datasets</Heading>;
      export const Housed = () => (
        <PageLayout.Header>
          <Heading as="h1">Datasets</Heading>
        </PageLayout.Header>
      );
    `);
    expect(sites.filter((site) => site.kind === "lookalike")).toEqual([
      expect.objectContaining({ family: "pageHeaders", what: "page-title Heading", line: 4 }),
    ]);
  });

  it("counts a clean design-system site with no overrides", () => {
    const sites = sitesOf(`
      import { ListTable } from "@langwatch/design-system/list-table";
      export const Rows = () => <ListTable>rows</ListTable>;
    `);
    expect(sites).toEqual([
      expect.objectContaining({ family: "tables", kind: "ds", site: true, props: {} }),
    ]);
  });

  it("finds literal pixel spacing and font sizes, not tokens", () => {
    const { literals } = censusSites({
      file,
      source: `
        import { Text } from "@langwatch/design-system/primitives";
        export const A = () => <Text padding="12px" fontSize="13px" gap={2} textStyle="sm" />;
        export const B = () => <div style={{ marginTop: 8, fontSize: "2xl" }} />;
      `,
    });
    expect(literals.map(({ kind, line }) => `${kind}:${line}`)).toEqual([
      "pixelSpacing:3",
      "fontSize:3",
      "pixelSpacing:4",
    ]);
  });

  /** @scenario "Each distinct restyle of a family counts once as a variant" */
  it("counts each distinct restyle once as a variant", () => {
    const sites = ["600px", "600px", "720px"].flatMap((width) =>
      sitesOf(`
        import { Drawer } from "@langwatch/design-system/drawer";
        export const D = () => <Drawer.Content maxWidth="${width}" />;
      `),
    );
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.drawers).toMatchObject({ overridden: 3, variants: 2 });
    expect(families.drawers.clusters[0]).toMatchObject({ count: 2 });
  });

  /** @scenario "The target API counts as adopted roots, matched by exact source and export" */
  it("recognises the callable target API by source and export as adopted roots", () => {
    const sites = sitesOf(`
      import { Drawer } from "@langwatch/design-system/drawer";
      import { Dialog } from "@langwatch/design-system/dialog";
      import { Card, CardGrid } from "@langwatch/design-system/card";
      import { ResourceTile } from "@langwatch/design-system/resource-tile";
      import { LoadMore } from "@langwatch/design-system/load-more";
      import { ListPage } from "@langwatch/design-system/list-page";
      import { ActionRow } from "@langwatch/design-system/action-row";
      export const All = () => (
        <>
          <Drawer title="Edit" size="md" onClose={close} />
          <Dialog title="Sure" size="sm" />
          <CardGrid columns={2}>
            <Card padding="sm" variant="nested" title="Policy" />
          </CardGrid>
          <ResourceTile title="Flow" />
          <LoadMore hasMore />
          <ListPage title="Runs" />
          <ActionRow />
        </>
      );
    `);
    expect(sites.map((site) => site.what)).toEqual([
      "Drawer",
      "Dialog",
      "CardGrid",
      "Card",
      "ResourceTile",
      "LoadMore",
      "ListPage",
      "ActionRow",
    ]);
    expect(sites.every((site) => site.adopted && site.disposition === "adopted")).toBe(true);
    const card = sites.find((site) => site.what === "Card");
    expect(card).toMatchObject({ props: {}, choices: { padding: "sm", variant: "nested" } });
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.cards).toMatchObject({ adoptedRoots: 3, parts: 0, overridden: 0 });
    expect(families.pagination).toMatchObject({ adoptedRoots: 1, roots: 1 });
  });

  /** @scenario "The target API counts as adopted roots, matched by exact source and export" */
  it("flags a style prop on the target API and an export from an unregistered source", () => {
    const sites = sitesOf(`
      import { Card } from "@langwatch/design-system/card";
      import { Drawer } from "@langwatch/design-system/drawer";
      import { LoadMore } from "@langwatch/design-system/settings-card";
      export const A = () => <Card padding="sm" bg="red.500" />;
      export const B = () => <Drawer size="md" width="40rem" />;
      export const C = () => <LoadMore />;
    `);
    expect(sites).toEqual([
      expect.objectContaining({ what: "Card", disposition: "violation", rule: "restyle" }),
      expect.objectContaining({ what: "Drawer", props: { width: "40rem" } }),
      expect.objectContaining({ what: "LoadMore", disposition: "unknown" }),
    ]);
    expect(sites[0]?.props).toEqual({ bg: "red.500" });
  });

  /** @scenario "Legacy raw parts are violations even when they carry no style props" */
  it("counts style-free legacy parts as violations sharing one owning root", () => {
    const sites = sitesOf(`
      ${imports.drawer}
      import { RawDialog } from "@langwatch/design-system/dialog";
      import { RawPagination } from "@langwatch/design-system/pagination";
      ${imports.primitives("EmptyState, Card")}
      export const D = () => (
        <Drawer.Root>
          <Drawer.Content>
            <Drawer.Header>
              <Drawer.Title />
            </Drawer.Header>
          </Drawer.Content>
        </Drawer.Root>
      );
      export const E = () => <EmptyState.Root><EmptyState.Title /></EmptyState.Root>;
      export const C = () => <Card.Root><Card.Body /></Card.Root>;
      export const R = () => <RawDialog.Root><RawDialog.Backdrop /><RawDialog.Content /></RawDialog.Root>;
      export const P = () => (
        <RawPagination.Root>
          <RawPagination.PrevTrigger />
          <RawPagination.NextTrigger />
          <RawPagination.Items />
        </RawPagination.Root>
      );
    `);
    expect(sites.every((site) => site.disposition === "violation")).toBe(true);
    expect(new Set(where(sites, "legacy-overlay-part").map((site) => site.family))).toEqual(
      new Set(["drawers"]),
    );
    expect(new Set(where(sites, "raw-export").map((site) => site.family))).toEqual(
      new Set(["dialogs", "pagination"]),
    );
    expect(where(sites, "legacy-empty-state")).toHaveLength(2);
    expect(where(sites, "legacy-card-part")).toHaveLength(2);
    const roots = (family: string) =>
      new Set(sites.filter((s) => s.family === family).map((s) => s.root));
    expect(roots("drawers").size).toBe(1);
    expect(roots("pagination").size).toBe(1);
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.pagination).toMatchObject({ roots: 1, affectedRoots: 1, parts: 4 });
    expect(families.drawers).toMatchObject({ roots: 1, parts: 4 });
  });

  /** @scenario "Namespace imports, aliases and destructuring resolve; shadowed names do not" */
  it("resolves namespace imports, const aliases and destructuring like direct imports", () => {
    const sites = sitesOf(`
      import * as DS from "@langwatch/design-system";
      import * as Overlay from "@langwatch/design-system/drawer";
      ${imports.drawer}
      const Panel = Drawer.Root;
      const { Content, Header: Top } = Drawer;
      export const A = () => <Overlay.Drawer.Root />;
      export const B = () => <Panel />;
      export const C = () => <Content />;
      export const D = () => <Top />;
      export const E = () => <DS.Drawer title="Edit" />;
    `);
    expect(sites.map((site) => [site.what, site.disposition])).toEqual([
      ["Drawer.Root", "violation"],
      ["Drawer.Root", "violation"],
      ["Drawer.Content", "violation"],
      ["Drawer.Header", "violation"],
      ["Drawer", "adopted"],
    ]);
  });

  /** @scenario "Namespace imports, aliases and destructuring resolve; shadowed names do not" */
  it("does not count a local or shadowing name as the design system", () => {
    const sites = sitesOf(`
      ${imports.primitives("Card")}
      ${imports.drawer}
      export const Param = ({ Card }) => <Card.Root padding={4} />;
      export function Inner() {
        const Drawer = makeDrawer();
        return <Drawer.Root padding={4} />;
      }
      export const Real = () => <Card.Root />;
    `);
    expect(sites).toEqual([expect.objectContaining({ what: "Card.Root", line: 9 })]);
    const local = sitesOf(`
      function Card() { return null; }
      export const X = () => <Card.Root padding={4} />;
      export const Y = () => <SomethingElse.Root padding={4} />;
    `);
    expect(local).toEqual([]);
  });

  /** @scenario "Namespace imports, aliases and destructuring resolve; shadowed names do not" */
  it("marks a wrapper it cannot see through as unknown, and a module copy as a caller", () => {
    const sites = sitesOf(`
      import styled from "@emotion/styled";
      import { Dialog } from "@langwatch/design-system/dialog";
      ${imports.drawer}
      import { Drawer as OwnDrawer } from "./own-drawer";
      const Pick = wide ? Drawer.Root : Dialog.Root;
      const Styled = styled(Drawer.Content);
      export const A = () => <Pick />;
      export const B = () => <Styled />;
      export const C = () => <OwnDrawer />;
    `);
    expect(sites.map((site) => [site.rule, site.disposition, site.family])).toEqual([
      ["unresolved-wrapper", "unknown", "drawers"],
      ["unresolved-wrapper", "unknown", "drawers"],
      ["local-copy", "violation", "drawers"],
    ]);
    expect(sites[2]?.wrapper).toBe("caller");
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.drawers).toMatchObject({ roots: 2, callers: 1, unknown: 2 });
  });

  /** @scenario "Literal spreads and style conditions count as restyles, split by kind" */
  it("reads literal spreads, const spreads and style-condition objects", () => {
    const sites = sitesOf(`
      ${imports.primitives("Card")}
      const tight = { p: 2, _hover: { bg: "red.50" } };
      export const A = () => <Card.Root {...{ p: 9 }} />;
      export const B = () => <Card.Root {...tight} />;
      export const D = () => (
        <Card.Root
          _hover={{ bg: "gray.100", cursor: "pointer" }}
          _selected={{ borderColor: "blue.500" }}
          color="fg.muted"
          textStyle="sm"
          fontWeight="bold"
        />
      );
    `);
    expect(sites[0]?.props).toEqual({ padding: "9" });
    expect(sites[1]?.props).toEqual({ padding: "2", "_hover.bg": "red.50" });
    expect(sites[2]?.props).toEqual({
      "_hover.bg": "gray.100",
      "_selected.borderColor": "blue.500",
      color: "fg.muted",
      textStyle: "sm",
      fontWeight: "bold",
    });
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.cards).toMatchObject({ geometryParts: 2, cosmeticParts: 2, opaqueParts: 0 });
    expect(driftKind({ prop: "_hover.padding" })).toBe("geometry");
    expect(driftKind({ prop: "css" })).toBe("opaque");
    expect(driftKind({ prop: "boxShadow" })).toBe("cosmetic");
  });

  /** @scenario "Literal spreads and style conditions count as restyles, split by kind" */
  it("marks a spread it cannot read as unknown, never clean", () => {
    const sites = sitesOf(`
      import { ListTable } from "@langwatch/design-system/list-table";
      export const A = (props) => <ListTable {...props} />;
      export const B = () => <ListTable {...{ p: 2 }} />;
    `);
    expect(sites).toEqual([
      expect.objectContaining({ disposition: "unknown", rule: "unresolved-props" }),
      expect.objectContaining({ disposition: "violation", rule: "restyle" }),
    ]);
  });

  /** @scenario "A card box needs a real border and carries a destination" */
  it("draws no card from a zero border, and gives a real one a destination", () => {
    const box = (attrs: string) =>
      sitesOf(`${imports.primitives("Box")} export const X = () => <Box ${attrs} />;`);
    expect(box('borderWidth={0} borderRadius="md"')).toEqual([]);
    expect(box('border="none" borderRadius="md"')).toEqual([]);
    expect(box('borderWidth="0px" borderRadius="md"')).toEqual([]);
    const real = box('border="1px solid" borderRadius="md"');
    expect(real).toEqual([
      expect.objectContaining({ rule: "card-box", disposition: "candidate", destination: "card" }),
    ]);
    expect(real[0]?.heuristic).toBe(false);
    expect(box('borderWidth={active ? 1 : 0} borderRadius="md"')[0]).toMatchObject({
      heuristic: true,
      reason: "border is not a literal",
    });
    expect(box('bg="bg.panel" borderRadius="md" borderWidth={0}')).toHaveLength(1);
  });

  /** @scenario "A card box needs a real border and carries a destination" */
  it("keeps a real square card and classifies other destinations", () => {
    const box = (attrs: string) =>
      sitesOf(`${imports.primitives("Box, Flex")} export const X = () => <Box ${attrs} />;`);
    const square = 'borderWidth="1px" borderRadius="md"';
    expect(box(`boxSize="200px" ${square}`)[0]).toMatchObject({ destination: "card" });
    expect(box(`boxSize="8" ${square}`)[0]).toMatchObject({ destination: "icon-tile" });
    expect(box(`${square} _focusWithin={{ borderColor: "blue.500" }}`)[0]).toMatchObject({
      destination: "input",
    });
    expect(box(`${square} role="radio"`)[0]).toMatchObject({ destination: "RadioCard" });
    const tooltip = sitesOf(`
      ${imports.primitives("Box")}
      import { Tooltip } from "@langwatch/design-system/tooltip";
      export const T = () => <Tooltip content={<Box borderWidth="1px" borderRadius="md" />} />;
    `);
    expect(tooltip[0]).toMatchObject({ destination: "tooltip" });
    expect(box(`role="alert" ${square}`)).toEqual([]);
  });

  /** @scenario "Pagination finds append actions and scopes Previous and Next to one pager" */
  it("finds append actions by their real labels", () => {
    const sites = sitesOf(`
      ${imports.primitives("Button")}
      export const A = () => <Button onClick={more}>Load More...</Button>;
      export const B = () => <Button>Show earlier</Button>;
      export const C = () => <Button onClick={() => query.fetchNextPage()}>{label}</Button>;
      export const D = () => <Button onClick={toggle}>Show more</Button>;
      export const E = () => <Button onClick={() => fetchMore()}>Show more</Button>;
      export const F = () => <Button>Save</Button>;
    `);
    expect(sites.map((site) => [site.rule, site.disposition])).toEqual([
      ["hand-append", "violation"],
      ["hand-append", "violation"],
      ["hand-append", "candidate"],
      ["hand-append", "candidate"],
      ["hand-append", "violation"],
    ]);
    expect(sites[0]?.what).toBe('hand append "Load More..."');
  });

  /** @scenario "Pagination finds append actions and scopes Previous and Next to one pager" */
  it("counts Previous and Next in one container as one pager, not across a file", () => {
    const one = sitesOf(`
      ${imports.primitives("Button, HStack")}
      export const P = () => (
        <HStack>
          <Button aria-label="Previous page" />
          <Button>Next</Button>
        </HStack>
      );
    `);
    expect(where(one, "hand-pagination")).toHaveLength(1);
    const apart = sitesOf(`
      ${imports.primitives("Button, Box, Stack")}
      export const P = () => (
        <Stack>
          <Box><Box><Box><Button>Previous</Button></Box></Box></Box>
          <Box><Box><Box><Button>Next</Button></Box></Box></Box>
        </Stack>
      );
    `);
    expect(where(apart, "hand-pagination")).toEqual([]);
  });

  /** @scenario "A list page is inferred per component and labelled heuristic" */
  it("infers a list page per component, as a heuristic candidate", () => {
    const sites = sitesOf(`
      import { PageLayout } from "@langwatch/design-system/page-layout";
      import { ListPage } from "@langwatch/design-system/list-page";
      ${imports.primitives("Table")}
      export const Old = () => <PageLayout.Header><Table.Root /></PageLayout.Header>;
      export const Header = () => <PageLayout.Header />;
      export const Rows = () => <Table.Root />;
      export const Both = () => <><PageLayout.Header /><ListPage /><Table.Root /></>;
    `);
    expect(where(sites, "list-page-inference")).toEqual([
      expect.objectContaining({ disposition: "candidate", heuristic: true, family: "listPages" }),
    ]);
  });

  /** @scenario "Headings carry a semantic level and an owning surface" */
  it("reads the semantic heading level and the owning surface", () => {
    const sites = sitesOf(`
      ${imports.primitives("Heading, Text, Card")}
      export const A = () => <h1>Title</h1>;
      export const B = () => <Text as="h1">Title</Text>;
      export const C = () => <Heading as="h2" size="lg">Title</Heading>;
      export const D = () => <Heading size="md">Section</Heading>;
      export const E = () => <Card.Root><Heading as="h1">In a card</Heading></Card.Root>;
    `);
    const titles = where(sites, "page-title-h1");
    expect(titles.map((site) => site.surface)).toEqual(["page", "page", "cards"]);
    expect(titles.every((site) => site.disposition === "violation")).toBe(true);
    expect(where(sites, "page-title-size")).toEqual([
      expect.objectContaining({ disposition: "candidate", heuristic: true, line: 5 }),
    ]);
  });

  /** @scenario "Headings carry a semantic level and an owning surface" */
  it("counts a raw Button in the page header or ListPage actions", () => {
    const sites = sitesOf(`
      import { PageLayout } from "@langwatch/design-system/page-layout";
      import { ListPage } from "@langwatch/design-system/list-page";
      ${imports.primitives("Button, Heading")}
      export const A = () => (
        <PageLayout.Header>
          <Heading as="h1">Runs</Heading>
          <Button>New</Button>
        </PageLayout.Header>
      );
      export const B = () => <ListPage actions={<Button>New</Button>} />;
      export const C = () => <ListPage><Button>Row</Button></ListPage>;
    `);
    expect(where(sites, "raw-header-button").map((site) => site.line)).toEqual([8, 11]);
    expect(where(sites, "page-title-h1")).toEqual([]);
  });

  /** @scenario "Hand empty-state text is a candidate and EmptyState parts are legacy" */
  it("reads empty-state text as heuristic candidates, expressions included", () => {
    const sites = sitesOf(`
      ${imports.primitives("Text")}
      import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
      export const A = () => <Text>No runs found yet</Text>;
      export const B = () => <Text>{"No datasets to show"}</Text>;
      export const C = () => <NoDataInfoBlock><Text>No runs found yet</Text></NoDataInfoBlock>;
    `);
    const empty = where(sites, "empty-text");
    expect(empty).toHaveLength(2);
    expect(empty.every((site) => site.disposition === "candidate" && site.heuristic)).toBe(true);
    expect(sites.filter((site) => site.disposition === "violation")).toEqual([]);
    expect(sites.find((site) => site.what === "NoDataInfoBlock")?.adopted).toBe(true);
  });

  /** @scenario "Roots, affected roots, parts and candidates are reported separately" */
  it("attributes parts to their owning root and keeps signatures in full", () => {
    const sites = sitesOf(`
      ${imports.drawer}
      ${imports.primitives("Card")}
      export const Edit = () => (
        <Drawer.Root>
          <Drawer.Content bg="bg">
            <Drawer.Header />
            <Drawer.Footer />
          </Drawer.Content>
        </Drawer.Root>
      );
      export const Extracted = () => <Drawer.Footer padding={4} />;
    `);
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.drawers).toMatchObject({
      roots: 2,
      affectedRoots: 2,
      parts: 5,
      candidates: 0,
      adoptedRoots: 0,
    });
    expect(sites[4]?.root).toMatch(/::Extracted$/);
    expect(sites[2]?.root).toBe(sites[0]?.root);
    const long = (tail: string) =>
      sitesOf(`
        ${imports.primitives("Card")}
        export const C = () => <Card.Root bg={isActive ? "bg.panel/60" : isHovered ? "bg.panel/80" : "${tail}"} />;
      `);
    const cards = summariseCensus({
      sites: [...long("bg.subtle"), ...long("bg.muted")],
      literals: [],
    });
    expect(cards.families.cards.variants).toBe(2);
    expect(cards.families.cards.clusters.map((cluster) => cluster.signature).join()).toContain(
      '"bg.subtle"',
    );
  });

  /** @scenario "Upgrade files are counted but marked as owned elsewhere" */
  it("marks upgrade files as owned by upgrade and lists them without failing the wave", () => {
    const upgrade = "modules/ops/browser/src/features/upgrades/ui/sections/step.tsx";
    const billing = "enterprise/modules/billing/browser/src/ui/blocks/upgrade-plan-block.tsx";
    const source = `${imports.drawer} export const D = () => <Drawer.Root />;`;
    const owned = sitesOf(source, upgrade);
    expect(owned[0]?.owner).toBe("upgrade");
    expect(sitesOf(source, billing)[0]?.owner).toBeUndefined();
    const result = evaluateCheck({ sites: owned, escapes: [] });
    expect(result.violations).toEqual([]);
    expect(result.ownedElsewhere).toEqual({
      upgrade: { violations: 1, candidates: 0, unknown: 0 },
    });
    expect(exitCodeOf({ result })).toBe(0);
    expect(summariseCensus({ sites: owned, literals: [] }).owners.upgrade?.violations).toBe(1);
  });

  /** @scenario "The check gate sorts sites into violations, approved escapes and candidates" */
  it("fails on an unsuppressed violation and passes it once an escape approves it", () => {
    const source = `${imports.drawer} export const D = () => <Drawer.Root />;`;
    const a = "modules/a/browser/src/a.tsx";
    const b = "modules/b/browser/src/b.tsx";
    const sites = [...sitesOf(source, a), ...sitesOf(source, b)];
    const escape: Escape = {
      path: b,
      rule: "legacy-overlay-part",
      reason: "resize rail",
      owner: "trace",
    };
    const result = evaluateCheck({ sites, escapes: [escape] });
    expect(result.violations.map((finding) => finding.file)).toEqual([a]);
    expect(result.approvedEscapes).toEqual([
      expect.objectContaining({ file: b, escape: { reason: "resize rail", owner: "trace" } }),
    ]);
    expect(exitCodeOf({ result })).toBe(1);
    const approved = evaluateCheck({
      sites,
      escapes: [escape, { ...escape, path: "modules/a/browser/src/**" }],
    });
    expect(exitCodeOf({ result: approved })).toBe(0);
  });

  /** @scenario "The check gate sorts sites into violations, approved escapes and candidates" */
  it("fails on an unclassified candidate or unknown until it has a disposition", () => {
    const box = (attrs: string, at: string) =>
      sitesOf(`${imports.primitives("Box")} export const X = () => <Box ${attrs} />;`, at);
    const card = 'borderWidth="1px" borderRadius="md"';
    const path1 = "modules/a/browser/src/a.tsx";
    const open = evaluateCheck({ sites: box(card, path1), escapes: [] });
    expect(open.unclassifiedCandidates).toHaveLength(1);
    expect(exitCodeOf({ result: open })).toBe(2);
    const reviewed: Escape = {
      path: path1,
      rule: "card-box",
      reason: "the diagram frame",
      owner: "x",
      disposition: "reviewed",
    };
    expect(
      exitCodeOf({ result: evaluateCheck({ sites: box(card, path1), escapes: [reviewed] }) }),
    ).toBe(0);
    const icon = evaluateCheck({ sites: box(`boxSize="8" ${card}`, path1), escapes: [] });
    expect(icon.classifiedCandidates).toHaveLength(1);
    expect(exitCodeOf({ result: icon })).toBe(0);
    const unknown = sitesOf(
      'import { ListTable } from "@langwatch/design-system/list-table"; export const T = (p) => <ListTable {...p} />;',
      path1,
    );
    expect(exitCodeOf({ result: evaluateCheck({ sites: unknown, escapes: [] }) })).toBe(2);
    expect(evaluateCheck({ sites: unknown, escapes: [] }).adoptedRoots).toHaveLength(1);
  });

  /** @scenario "The check gate sorts sites into violations, approved escapes and candidates" */
  it("refuses an escape without a reason, and matches paths by glob or directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "census-escapes-"));
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([{ path: "a", rule: "card-box", owner: "x", reason: " " }]));
    expect(() => loadEscapes({ file: bad })).toThrow(/needs a non-empty "reason"/);
    const good = path.join(dir, "good.json");
    writeFileSync(good, JSON.stringify([{ path: "a/**", rule: "*", owner: "x", reason: "why" }]));
    expect(loadEscapes({ file: good })).toHaveLength(1);
    expect(matchesPath({ file: "modules/a/browser/src/x/y.tsx", glob: "modules/a/**" })).toBe(true);
    expect(matchesPath({ file: "modules/a/browser/src/x/y.tsx", glob: "modules/a/*" })).toBe(false);
    expect(matchesPath({ file: "modules/a/browser/src/y.tsx", glob: "modules/a/browser" })).toBe(
      true,
    );
    expect(matchesPath({ file: "modules/ab/browser/src/y.tsx", glob: "modules/a" })).toBe(false);
    const registry = targetApi().find((entry) => entry.export === "Card");
    expect(registry).toMatchObject({ source: "@langwatch/design-system/card", family: "cards" });
    expect(typeof registry?.planned).toBe("boolean");
  });

  /** @scenario "The new tabs and table shapes count as adopted; raw parts are violations" */
  it("adopts the new tabs, toolbar and ListTable parts and flags raw Tabs and Table parts", () => {
    const sites = sitesOf(`
      import { ContentTabs } from "@langwatch/design-system/content-tabs";
      import { CodeTabs } from "@langwatch/design-system/code-tabs";
      import { MetricTabs } from "@langwatch/design-system/metric-tabs";
      import { TableToolbar } from "@langwatch/design-system/table-toolbar";
      import { ColumnPicker } from "@langwatch/design-system/column-picker";
      import { SelectionActionBar } from "@langwatch/design-system/selection-action-bar";
      import { ListTable } from "@langwatch/design-system/list-table";
      export const A = () => (
        <>
          <ContentTabs density="compact" mount="all" />
          <CodeTabs />
          <MetricTabs />
          <TableToolbar />
          <ColumnPicker />
          <SelectionActionBar placement="inline" />
          <ListTable>
            <ListTable.Row>
              <ListTable.Cell align="end">x</ListTable.Cell>
              <ListTable.RowAction>x</ListTable.RowAction>
            </ListTable.Row>
          </ListTable>
        </>
      );
    `);
    expect(sites.filter((site) => site.site).every((site) => site.disposition === "adopted")).toBe(
      true,
    );
    expect(sites.filter((site) => site.site).map((site) => site.what)).toEqual([
      "ContentTabs",
      "CodeTabs",
      "MetricTabs",
      "TableToolbar",
      "ColumnPicker",
      "SelectionActionBar",
      "ListTable",
    ]);
    expect(sites.find((site) => site.what === "ContentTabs")?.choices).toEqual({
      density: "compact",
      mount: "all",
    });
    expect(sites.filter((site) => site.what.startsWith("ListTable."))).toHaveLength(3);
    const { families } = summariseCensus({ sites, literals: [] });
    expect(families.tabs).toMatchObject({ adoptedRoots: 3, parts: 0 });
    expect(families.tables).toMatchObject({ adoptedRoots: 4, parts: 0 });

    const raw = sitesOf(`
      ${imports.primitives("Tabs, Table")}
      export const T = () => (
        <Tabs.Root>
          <Tabs.List><Tabs.Trigger /></Tabs.List>
          <Tabs.Content />
        </Tabs.Root>
      );
      export const R = () => <Tabs.RootProvider><Tabs.List /></Tabs.RootProvider>;
      export const H = () => (
        <Table.Root>
          <Table.Header><Table.Row><Table.ColumnHeader /></Table.Row></Table.Header>
          <Table.Body><Table.Row><Table.Cell /></Table.Row></Table.Body>
        </Table.Root>
      );
    `);
    expect(raw.every((site) => site.disposition === "violation")).toBe(true);
    expect(where(raw, "legacy-tabs-part")).toHaveLength(6);
    expect(where(raw, "legacy-table-part")).toHaveLength(6);
    expect(where(raw, "hand-table")).toHaveLength(1);
    const summary = summariseCensus({ sites: raw, literals: [] });
    expect(summary.families.tabs).toMatchObject({ roots: 2, affectedRoots: 2 });
    expect(summary.families.tables).toMatchObject({ roots: 1, affectedRoots: 1 });
  });

  /** @scenario "Raw tabs and tables are found by what they import, not by how they are spelled" */
  it("finds flat, aliased, native, polymorphic and factory spellings, and not look-alikes", () => {
    const rules = (source: string) =>
      sitesOf(source)
        .filter((site) => site.disposition === "violation")
        .map((site) => `${site.rule}:${site.what}`);
    const prim = imports.primitives("TabsRoot, TabsList as L, TableRoot, TableRow as R, chakra");
    expect(
      rules(
        `${prim} export const A = () => <><TabsRoot><L /></TabsRoot><TableRoot><R /></TableRoot></>;`,
      ),
    ).toEqual([
      "legacy-tabs-part:TabsRoot",
      "legacy-tabs-part:TabsList",
      "hand-table:TableRoot",
      "legacy-table-part:TableRow",
    ]);
    expect(rules(`export const A = () => <table><tbody><tr><td /></tr></tbody></table>;`)).toEqual([
      "native-table:<table> outside ListTable",
      "legacy-table-part:<tbody> outside ListTable",
      "legacy-table-part:<tr> outside ListTable",
      "legacy-table-part:<td> outside ListTable",
    ]);
    const poly = `${imports.primitives("Box, chakra")}
      const Grid = chakra("table");
      export const A = () => <><Box as="table" /><chakra.table /><Box as="section" /></>;`;
    expect(rules(poly)).toEqual([
      'native-table:chakra("table") outside ListTable',
      "native-table:<table> outside ListTable",
      "native-table:<table> outside ListTable",
    ]);
    const hooks = `${imports.primitives("useTabs as useRawTabsHook")}
      export const A = () => { useRawTabsHook({}); return null; };`;
    expect(rules(hooks)).toEqual(["legacy-tabs-part:useTabs()"]);
    expect(
      rules(`import { useTabs } from "./local"; import { Table } from "./table";
        export const A = ({ table }) => { useTabs(); return <Table data={table} />; };`),
    ).toEqual([]);
  });

  /** @scenario "An escape names one rule and may name one line" */
  it("approves only the named line, and the shipped registry has no wildcard rule", () => {
    const at = "modules/a/browser/src/a.tsx";
    const source = `export const A = () => <><table /><table /></>;`;
    const sites = sitesOf(source, at);
    const escape: Escape = { path: at, rule: "native-table", line: 1, reason: "r", owner: "x" };
    expect(evaluateCheck({ sites, escapes: [escape] }).approvedEscapes).toHaveLength(2);
    const lines = sitesOf("export const A = () => (\n<>\n<table />\n<table />\n</>\n);", at);
    const one = evaluateCheck({ sites: lines, escapes: [{ ...escape, line: 4 }] });
    expect(one.approvedEscapes.map((found) => found.line)).toEqual([4]);
    expect(one.violations.map((found) => found.line)).toEqual([3]);
    const dir = mkdtempSync(path.join(tmpdir(), "census-line-"));
    const bad = path.join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify([{ path: "a", rule: "r", owner: "x", reason: "y", line: 0 }]),
    );
    expect(() => loadEscapes({ file: bad })).toThrow(/"line" to be a positive integer/);
    expect(loadEscapes().filter((entry) => entry.rule === "*")).toEqual([]);
  });

  /** @scenario "A gate that proves nothing refuses instead of passing" */
  it("refuses a glob that matches nothing and too few adopted roots, and lists open owners", () => {
    const files = ["modules/a/browser/src/a.tsx"];
    const base = { paths: ["modules/a/**"], files, adopted: 3, minimum: 0 };
    expect(gateRefusal(base)).toBeUndefined();
    expect(gateRefusal({ ...base, paths: ["modules/a/**", "modules/z/**"] })).toMatch(/modules\/z/);
    expect(gateRefusal({ ...base, files: [] })).toMatch(/No browser source/);
    expect(gateRefusal({ ...base, minimum: 4 })).toMatch(/3 adopted roots, fewer than/);
    expect(gateRefusal({ ...base, minimum: -1 })).toMatch(/whole number/);
    const upgrade = "modules/ops/browser/src/features/upgrades/ui/sections/step.tsx";
    const source = `${imports.drawer} export const D = () => <Drawer.Root />;`;
    const open = evaluateCheck({ sites: sitesOf(source, upgrade), escapes: [] });
    expect(openOwners({ result: open })).toEqual(["upgrade"]);
    expect(openOwners({ result: evaluateCheck({ sites: [], escapes: [] }) })).toEqual([]);
  });

  describe("given a ListTable.PaddingRow height", () => {
    const rows = (row: string) => `
      import { ListTable as Table } from "@langwatch/design-system/list-table";
      export const Rows = () => (
        <Table>
          ${row}
        </Table>
      );
    `;

    /** @scenario "A padding row's height is its own prop, not a restyle" */
    it("is not a restyle, while the same height on an ordinary row is", () => {
      const spacer = sitesOf(rows("<Table.PaddingRow columns={3} height={120} />"));
      const ordinary = sitesOf(rows("<Table.Row height={120} />"));
      expect(where(spacer, "restyle")).toEqual([]);
      expect(where(ordinary, "restyle").length).toBeGreaterThan(0);
    });
  });
});

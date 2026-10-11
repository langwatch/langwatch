import { describe, expect, it } from "vitest";

import { censusSites, summariseCensus } from "../.storybook/census.ts";

const file = "modules/example/browser/src/ui/example.tsx";
const sitesOf = (source: string) => censusSites({ file, source }).sites;

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
});

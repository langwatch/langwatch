import { Box, Table } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * The frame the setup screen's tables sit in.
 *
 * ONE COMPONENT RATHER THAN TWO COPIES, because the domains table and the
 * break-glass table two steps below it are meant to read as one screen — both
 * files said so in a comment, and both then drew the frame themselves, which
 * is exactly how two things that must match stop matching.
 *
 * WHAT IT ADDS. The tables were bare `Table.Root`s: hairline rules between
 * rows and no outline at all, so on a page of bordered cards they read as
 * loose text rather than as an object. And a table has a natural minimum
 * width — a long domain, a long address — which in a stretching column
 * pushes the whole step sideways instead of scrolling. `minWidth={0}` is the
 * load-bearing half of that: without it a flex child refuses to shrink below
 * its content and `overflowX` never engages, which is why the obvious fix of
 * adding `overflow: auto` on its own does nothing.
 */
export function SsoSettingsTable({ children }: { children: ReactNode }) {
  return (
    <Box
      width="full"
      // Lets the box shrink under its content so the scroll below can happen
      // at all. See above — this is the half that is easy to leave out.
      minWidth={0}
      overflowX="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
    >
      <Table.Root
        size="sm"
        variant="line"
        // The last row's own rule would sit a hairline above the frame's
        // bottom edge and read as a double border.
        css={{ "& tbody tr:last-of-type td": { borderBottomWidth: 0 } }}
      >
        {children}
      </Table.Root>
    </Box>
  );
}

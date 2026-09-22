// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The frame the setup screen's tables sit in — one component rather than two
 * copies, because the domains table and the break-glass table two steps below
 * it are meant to read as one screen, and two things that must match stop
 * matching the moment each draws its own frame.
 */
import { Box, Table } from "@chakra-ui/react";
import type { ReactNode } from "react";

export function SettingsTable({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Box
      width="full"
      // Lets the box shrink under its content so the scroll can happen at
      // all: a flex child refuses to go below its content's natural width,
      // and `overflowX` on its own then never engages.
      minWidth={0}
      overflowX="auto"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
    >
      <Table.Root
        size="sm"
        variant="line"
        data-testid={testId}
        // The last row's own rule would sit a hairline above the frame's
        // bottom edge and read as a double border.
        css={{ "& tbody tr:last-of-type td": { borderBottomWidth: 0 } }}
      >
        {children}
      </Table.Root>
    </Box>
  );
}

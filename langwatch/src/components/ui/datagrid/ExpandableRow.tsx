import type { ReactNode } from "react";
import { Box, Collapsible } from "@chakra-ui/react";
import type { Row } from "@tanstack/react-table";

interface ExpandableRowProps<T> {
  row: Row<T>;
  isExpanded: boolean;
  colSpan: number;
  children: ReactNode;
}

/**
 * Expandable row content container with collapse animation
 */
export function ExpandableRow<T>({
  row,
  isExpanded,
  colSpan,
  children,
}: ExpandableRowProps<T>) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <Collapsible.Root open={isExpanded}>
          <Collapsible.Content>
            <Box
              bg="gray.50"
              borderTop="1px solid"
              borderBottom="1px solid"
              borderColor="gray.200"
              p={4}
            >
              {children}
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      </td>
    </tr>
  );
}

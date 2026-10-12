import { Table } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

/**
 * The one table look inside an opened row: the list table's header (small, medium, muted,
 * sentence case) and quiet rules, flush to the panel's left edge. Targets and runs both use it.
 */
export function PanelTable(props: ComponentProps<typeof Table.Root>) {
  return (
    <Table.Root
      size="sm"
      variant="line"
      css={{
        "& th": {
          fontSize: "xs",
          fontWeight: "medium",
          color: "var(--chakra-colors-fg-muted)",
          whiteSpace: "nowrap",
          paddingY: "6px",
          verticalAlign: "bottom",
        },
        "& th, & td": { borderColor: "var(--chakra-colors-border-muted)" },
        "& td": { paddingY: "6px", textStyle: "bodySm" },
        "& th:first-of-type, & td:first-of-type": { paddingLeft: 0 },
        "& th:last-of-type, & td:last-of-type": { paddingRight: 0 },
        "& tbody tr:last-of-type td": { borderBottomWidth: 0 },
      }}
      {...props}
    />
  );
}

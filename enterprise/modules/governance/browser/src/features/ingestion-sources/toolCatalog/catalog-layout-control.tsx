// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { HStack, Text } from "@chakra-ui/react";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { LayoutGrid, List as ListIcon } from "lucide-react";

import type { ToolCatalogLayout } from "./tool-catalog-cards";

/** The grid/list switch for the Catalog pane. Never a native select. */
export function CatalogLayoutControl({
  layout,
  onChange,
}: {
  layout: ToolCatalogLayout;
  onChange: (layout: ToolCatalogLayout) => void;
}) {
  return (
    <SegmentedControl
      size="sm"
      value={layout}
      onValueChange={({ value }) => onChange(value === "list" ? "list" : "grid")}
      aria-label="Catalog layout"
      items={[
        {
          value: "grid",
          label: (
            <HStack gap={1.5}>
              <LayoutGrid size={13} />
              <Text as="span">Grid</Text>
            </HStack>
          ),
        },
        {
          value: "list",
          label: (
            <HStack gap={1.5}>
              <ListIcon size={13} />
              <Text as="span">List</Text>
            </HStack>
          ),
        },
      ]}
    />
  );
}

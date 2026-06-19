"use client";

import { SegmentGroup } from "@chakra-ui/react";
import * as React from "react";

interface Item {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps extends SegmentGroup.RootProps {
  items: Array<string | Item>;
}

function normalize(items: Array<string | Item>): Item[] {
  return items.map((item) =>
    typeof item === "string" ? { value: item, label: item } : item,
  );
}

export const SegmentedControl = React.forwardRef<
  HTMLDivElement,
  SegmentedControlProps
>(function SegmentedControl(props, ref) {
  const { items, ...rest } = props;
  const data = React.useMemo(() => normalize(items), [items]);

  return (
    <SegmentGroup.Root ref={ref} {...rest}>
      <SegmentGroup.Indicator />
      {data.map((item) => (
        <SegmentGroup.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
        >
          <SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      ))}
    </SegmentGroup.Root>
  );
});

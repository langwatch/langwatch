"use client";

import { SegmentGroup } from "@chakra-ui/react";
import * as React from "react";

interface Item {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps extends SegmentGroup.RootProps {
  items: (string | Item)[];
}

function normalize(items: (string | Item)[]): Item[] {
  return items.map((item) => (typeof item === "string" ? { value: item, label: item } : item));
}

export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl(props, ref) {
    const { items, ...rest } = props;
    const data = React.useMemo(() => normalize(items), [items]);

    return (
      <SegmentGroup.Root
        ref={ref}
        padding="2px"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        background="bg.subtle"
        css={{ "--segment-radius": "radii.md" }}
        {...rest}
      >
        <SegmentGroup.Indicator
          background="bg.panel"
          borderWidth="1px"
          borderColor="border.emphasized"
          boxShadow="sm"
        />
        {data.map((item) => (
          <SegmentGroup.Item
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            cursor={item.disabled ? "not-allowed" : "pointer"}
          >
            <SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
        ))}
      </SegmentGroup.Root>
    );
  },
);

export { SegmentGroup as RawSegmentGroup } from "@chakra-ui/react";

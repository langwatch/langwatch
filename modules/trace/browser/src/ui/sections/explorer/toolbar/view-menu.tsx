import {
  MenuContent,
  MenuItemGroup,
  MenuRadioItem,
  MenuRadioItemGroup,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@langwatch/design-system/menu";
import { Button } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { ChevronDown, Layers } from "lucide-react";
import type React from "react";

import { useViewStore } from "../../../../behavior/explorer.store.ts";
import { type GroupingMode } from "../../../../behavior/view.slice.ts";
import {
  type Density,
  useDensityStore,
} from "../../../../features/explorer/behavior/density.store.ts";

const GROUPING_OPTIONS: Record<GroupingMode, string> = {
  flat: "Flat",
  "by-conversation": "By Conversation",
  "by-service": "By Service",
  "by-user": "By User",
  "by-model": "By Model",
};

const DENSITY_OPTIONS: Record<Density, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
};

const isGroupingMode = (value: string): value is GroupingMode => value in GROUPING_OPTIONS;
const isDensity = (value: string): value is Density => value in DENSITY_OPTIONS;

/**
 * How the table lays out its rows: grouping and density, behind one trigger. The trigger
 * turns subtle while rows are grouped, so a grouped table never looks like the flat one.
 */
export const ViewMenu: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

  return (
    <MenuRoot positioning={{ placement: "bottom-end" }}>
      <Tooltip
        content={
          grouping === "flat"
            ? "Group rows and set density"
            : `Grouped: ${GROUPING_OPTIONS[grouping]}`
        }
        positioning={{ placement: "bottom" }}
      >
        <TriggerAnchor>
          <MenuTrigger asChild>
            <Button
              size="xs"
              variant={grouping === "flat" ? "outline" : "subtle"}
              aria-label={`View options. Rows ${GROUPING_OPTIONS[grouping]}, ${DENSITY_OPTIONS[density]} density.`}
              data-testid="trace-toolbar-view"
              gap={1}
              paddingX={2}
            >
              <Layers size={14} />
              {!compact && "View"}
              <ChevronDown size={12} />
            </Button>
          </MenuTrigger>
        </TriggerAnchor>
      </Tooltip>
      <MenuContent minWidth="200px">
        <MenuItemGroup title="Group rows">
          <MenuRadioItemGroup
            value={grouping}
            onValueChange={(e) => {
              if (isGroupingMode(e.value)) setGrouping(e.value);
            }}
          >
            {Object.entries(GROUPING_OPTIONS).map(([value, label]) => (
              <MenuRadioItem key={value} value={value}>
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioItemGroup>
        </MenuItemGroup>
        <MenuSeparator />
        <MenuItemGroup title="Density">
          <MenuRadioItemGroup
            value={density}
            onValueChange={(e) => {
              if (isDensity(e.value)) setDensity(e.value);
            }}
          >
            {Object.entries(DENSITY_OPTIONS).map(([value, label]) => (
              <MenuRadioItem key={value} value={value}>
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioItemGroup>
        </MenuItemGroup>
      </MenuContent>
    </MenuRoot>
  );
};

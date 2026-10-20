import {
  MenuContent,
  MenuRadioItem,
  MenuRadioItemGroup,
  MenuRoot,
  MenuTrigger,
} from "@langwatch/design-system/menu";
import { Button, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { ChevronDown, Layers } from "lucide-react";
import type React from "react";

import { useViewStore } from "../../../../behavior/explorer.store.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { type GroupingMode } from "../../../../behavior/view.slice.ts";
import { groupingLabels } from "../../../../model/grouping-labels.ts";

const isGroupingMode = (value: string): value is GroupingMode =>
  Object.hasOwn(groupingLabels({ codingAgentScope: false }), value);

/**
 * "Group by: <X>" picker. The trigger turns subtle while rows are grouped, so a grouped
 * table never looks like the flat one; when compact it keeps only the icon and chevron.
 */
export const GroupingSelect: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);
  const { team } = useOrganizationTeamProject();
  const options = groupingLabels({ codingAgentScope: !!team?.isPersonal });
  const label = options[grouping];

  return (
    <MenuRoot positioning={{ placement: "bottom-start" }}>
      <Tooltip
        content={
          grouping === "flat"
            ? `Group rows by ${options["by-conversation"].toLowerCase()}, service, user or model`
            : `Rows grouped by ${label.toLowerCase()}`
        }
        positioning={{ placement: "bottom" }}
      >
        <TriggerAnchor>
          <MenuTrigger asChild>
            <Button
              size="xs"
              variant={grouping === "flat" ? "outline" : "subtle"}
              aria-label={`Group by: ${label}`}
              data-testid="trace-toolbar-grouping"
              gap={1}
              paddingX={2}
              flexShrink={0}
            >
              <Layers size={14} />
              {!compact && (
                <>
                  <Text as="span" color="fg.muted" fontWeight="normal">
                    Group by:
                  </Text>
                  {label}
                </>
              )}
              <ChevronDown size={12} />
            </Button>
          </MenuTrigger>
        </TriggerAnchor>
      </Tooltip>
      <MenuContent minWidth="160px">
        <MenuRadioItemGroup
          value={grouping}
          onValueChange={(e) => {
            if (isGroupingMode(e.value)) setGrouping(e.value);
          }}
        >
          {Object.entries(options).map(([value, optionLabel]) => (
            <MenuRadioItem key={value} value={value}>
              {optionLabel}
            </MenuRadioItem>
          ))}
        </MenuRadioItemGroup>
      </MenuContent>
    </MenuRoot>
  );
};

import { Icon } from "@langwatch/design-system/primitives";
import { RawTooltip as Tooltip } from "@langwatch/design-system/tooltip";
import { LuBuilding } from "react-icons/lu";

export function OrganizationBadge() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Icon color="purple">
          <LuBuilding />
        </Icon>
      </Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content>
          This prompt is available to all projects in the organization
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

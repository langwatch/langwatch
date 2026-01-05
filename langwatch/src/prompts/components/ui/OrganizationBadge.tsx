import { Icon } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { LuBuilding } from "react-icons/lu";

/**
 * Renders an organization scope badge with an icon.
 * Single Responsibility: Display organization-level scope indicator for prompt configurations.
 * @returns A purple outlined Badge labeled "Organization".
 */
export function OrganizationBadge() {
  return (
    <Tooltip content="This prompt is available to all projects in the organization">
      <Icon color="purple">
        <LuBuilding />
      </Icon>
    </Tooltip>
  );
}

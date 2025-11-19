import { Badge, HStack } from "@chakra-ui/react";
import { LuBuilding } from "react-icons/lu";

/**
 * Renders an organization scope badge with an icon.
 * Single Responsibility: Display organization-level scope indicator for prompt configurations.
 * @returns A purple outlined Badge labeled "Organization".
 */
export function OrganizationBadge() {
  return (
    <Badge colorPalette="purple" variant="outline">
      <HStack>
        <LuBuilding />
        Organization
      </HStack>
    </Badge>
  );
}

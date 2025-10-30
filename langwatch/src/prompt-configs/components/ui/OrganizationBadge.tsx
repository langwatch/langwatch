import { Badge, HStack } from "@chakra-ui/react";
import { LuBuilding } from "react-icons/lu";

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

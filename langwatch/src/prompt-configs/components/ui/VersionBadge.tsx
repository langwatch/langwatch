import { Badge } from "@chakra-ui/react";

export function VersionBadge({ version }: { version: number }) {
  return (
    <Badge colorPalette="green" border="1px solid" borderColor="green.200">
      v{version}
    </Badge>
  );
}

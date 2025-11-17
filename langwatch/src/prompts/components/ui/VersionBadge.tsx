import { Badge } from "@chakra-ui/react";

/**
 * Single Responsibility: Displays a version number in a styled badge component.
 *
 * @param version - The version number to display
 * @returns A Badge component displaying the version number with a green color scheme
 */
export function VersionBadge({ version }: { version: number }) {
  return (
    <Badge colorPalette="green" border="1px solid" borderColor="green.200">
      v{version}
    </Badge>
  );
}

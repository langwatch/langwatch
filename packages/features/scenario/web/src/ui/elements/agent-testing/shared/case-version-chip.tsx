/**
 * The version of a scenario, as a chip: "v3".
 *
 * A case with no version yet renders nothing, so the chip can be placed
 * before every case carries a version.
 */
import { Badge } from "@chakra-ui/react";

export type CaseVersionChipProps = {
  version?: number | null;
};

export function CaseVersionChip({ version }: CaseVersionChipProps) {
  if (typeof version !== "number") return null;

  return (
    <Badge size="xs" variant="subtle" colorPalette="gray" data-testid={`case-version-${version}`}>
      v{version}
    </Badge>
  );
}

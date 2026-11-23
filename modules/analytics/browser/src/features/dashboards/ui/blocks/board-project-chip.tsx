/**
 * Whose data a board shows, read-only: Dashboards has no project switcher (ADR-002).
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { HStack, Text } from "@langwatch/design-system/primitives";

/** "Data from <project>", the project the board reads now. */
export function BoardProjectChip({ name }: { name: string }) {
  return (
    <HStack gap={1.5} paddingX={1} textStyle="bodySm" aria-label={`Data from ${name}`}>
      <Text color="fg.muted">Data from</Text>
      <Text fontWeight="medium" truncate maxWidth="180px">
        {name}
      </Text>
    </HStack>
  );
}

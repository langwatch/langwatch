/** The "+" beside a sidebar heading that makes a new dashboard. */

import { Box, IconButton } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

export function NewDashboardButton({
  isCreating,
  onCreate,
}: {
  isCreating: boolean;
  onCreate: () => void;
}) {
  return (
    <Box marginLeft="auto" display="flex">
      <IconButton
        size="2xs"
        variant="ghost"
        minWidth={0}
        boxSize={4}
        color="fg.subtle"
        _hover={{ color: "fg", background: "border/60" }}
        aria-label="New dashboard"
        title="New dashboard"
        loading={isCreating}
        onClick={onCreate}
      >
        <Plus size={12} aria-hidden />
      </IconButton>
    </Box>
  );
}

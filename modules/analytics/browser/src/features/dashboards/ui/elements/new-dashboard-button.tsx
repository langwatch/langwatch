/** The "+" beside a sidebar heading that opens a new dashboard, stored on its first edit. */

import { Box, IconButton } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

export function NewDashboardButton({ onCreate }: { onCreate: () => void }) {
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
        onClick={onCreate}
      >
        <Plus size={12} aria-hidden />
      </IconButton>
    </Box>
  );
}

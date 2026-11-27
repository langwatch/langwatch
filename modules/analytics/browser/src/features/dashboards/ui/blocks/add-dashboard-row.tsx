import { Box } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

/** The dotted-outline first item while nothing is pinned; it does what the "+" does. */
export function AddDashboardRow({ onAdd }: { onAdd: () => void }) {
  return (
    <Box as="li" listStyleType="none" width="full">
      <Box
        as="button"
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border.emphasized"
        paddingX={2}
        paddingY="3px"
        textStyle="bodySm"
        color="fg.subtle"
        cursor="pointer"
        _hover={{ color: "fg", background: "border/50" }}
        onClick={onAdd}
      >
        <Plus size={14} aria-hidden />
        Add dashboard
      </Box>
    </Box>
  );
}

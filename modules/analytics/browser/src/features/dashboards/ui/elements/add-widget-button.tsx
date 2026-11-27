/** A board header's "Add a widget", on a board the reader may change. */

import { Button } from "@langwatch/design-system/primitives";
import { Plus } from "lucide-react";

export function AddWidgetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      height={8}
      paddingX={3}
      gap={1.5}
      borderRadius="lg"
      borderColor="border"
      textStyle="label"
      fontWeight="medium"
      _hover={{ borderColor: "border.emphasized", background: "bg.muted" }}
      onClick={onClick}
    >
      <Plus size={15} strokeWidth={2} /> Add a widget
    </Button>
  );
}

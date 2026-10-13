/**
 * How many things are behind a tab, said the same way on every tab. A zero is
 * an answer and shows; a count still being read draws nothing, so no badge
 * reads 0 for a moment and then flips. The hidden space names the tab "People 5".
 */
import { Badge, VisuallyHidden } from "@chakra-ui/react";

export function TabCount({ value }: { value: number | undefined }) {
  if (value === void 0) return null;

  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette="gray"
      fontVariantNumeric="tabular-nums"
      minWidth="1.5em"
      justifyContent="center"
    >
      <VisuallyHidden> </VisuallyHidden>
      {value}
    </Badge>
  );
}

import { Text, VisuallyHidden } from "@chakra-ui/react";

/**
 * The one mark for a value that is not there (no model, never run, no owner): an em dash
 * in fg.subtle, read aloud as `label`. Never "N/A", "-", "null" or an empty cell.
 */
export function EmptyValue({ label = "None" }: { label?: string }) {
  return (
    <Text as="span" color="fg.subtle" data-empty-value="">
      <span aria-hidden>—</span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </Text>
  );
}

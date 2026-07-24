import { Text } from "@chakra-ui/react";
import { RedactedInline } from "~/components/ui/RedactedField";
import type { TraceListItem } from "../../../../../types/trace";
import { contentToText } from "../../../chatContent";
import type { CellDef } from "../../types";

export const InputCell = {
  id: "input",
  label: "Input",
  render: ({ row }) => {
    const text = contentToText(row.input);
    if (!text) {
      // Redacted (server nulled the content) reads as a lock + "Redacted", not
      // the em-dash used for genuinely-absent input — so the operator knows the
      // content exists but is hidden by a privacy rule.
      if (row.inputRedacted) {
        return <RedactedInline visibleTo={row.inputVisibleTo} size="xs" />;
      }
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <Text textStyle="sm" color="fg.muted" lineClamp={2}>
        {text}
      </Text>
    );
  },
} as const satisfies CellDef<TraceListItem>;

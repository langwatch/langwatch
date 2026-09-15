import { Text } from "@chakra-ui/react";
import { RedactedInline } from "../../../../../redacted-field.tsx";
import type { TraceListItem } from "../../../../types/trace.ts";
import { contentToText } from "../../../../../../../model/explorer/trace-table/chat-content.ts";
import type { CellDef } from "../../types.ts";

export const OutputCell = {
  id: "output",
  label: "Output",
  render: ({ row }) => {
    const text = contentToText(row.output);
    if (!text) {
      // Redacted (server nulled the content) reads as a lock + "Redacted", not
      // the em-dash used for genuinely-absent output — so the operator knows the
      // content exists but is hidden by a privacy rule.
      if (row.outputRedacted) {
        return <RedactedInline visibleTo={row.outputVisibleTo} size="xs" />;
      }
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <Text textStyle="sm" color="fg" lineClamp={2}>
        {text}
      </Text>
    );
  },
} as const satisfies CellDef<TraceListItem>;

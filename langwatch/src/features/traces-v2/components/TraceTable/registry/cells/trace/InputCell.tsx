import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { contentToText } from "../../../chatContent";
import type { CellDef } from "../../types";

export const InputCell = {
  id: "input",
  label: "Input",
  render: ({ row }) => {
    const text = contentToText(row.input);
    if (!text) {
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

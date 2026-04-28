import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";
import { contentToText } from "../../../chatContent";

export const InputCell: CellDef<TraceListItem> = {
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
};

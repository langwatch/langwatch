import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";
import { contentToText } from "../../../chatContent";

export const OutputCell: CellDef<TraceListItem> = {
  id: "output",
  label: "Output",
  render: ({ row }) => {
    const text = contentToText(row.output);
    if (!text) {
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
};

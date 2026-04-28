import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { contentToText } from "../../../chatContent";
import type { CellDef } from "../../types";

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

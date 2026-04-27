import { Badge, HStack, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { abbreviateModel } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const ModelCell: CellDef<TraceListItem> = {
  id: "model",
  label: "Model",
  render: ({ row }) => {
    if (row.models.length === 0) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    const primary = abbreviateModel(row.models[0]!);
    const extra = row.models.length - 1;
    return (
      <HStack gap={1}>
        <MonoCell truncate whiteSpace={undefined}>
          {primary}
        </MonoCell>
        {extra > 0 && (
          <Badge size="xs" variant="outline">
            +{extra}
          </Badge>
        )}
      </HStack>
    );
  },
  renderComfortable: ({ row }) => {
    if (row.models.length === 0) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    const primary = abbreviateModel(row.models[0]!);
    const extra = row.models.length - 1;
    return (
      <HStack gap={2}>
        <Text textStyle="sm" color="fg.muted" fontFamily="mono" truncate>
          {primary}
        </Text>
        {extra > 0 && (
          <Badge size="sm" variant="outline">
            +{extra}
          </Badge>
        )}
      </HStack>
    );
  },
};

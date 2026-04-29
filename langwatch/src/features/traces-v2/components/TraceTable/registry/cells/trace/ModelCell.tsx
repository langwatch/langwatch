import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceListItem } from "../../../../../types/trace";
import { abbreviateModel } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

function ExtraModelsBadge({
  models,
  size,
}: {
  models: string[];
  size: "xs" | "sm";
}) {
  return (
    <Tooltip
      showArrow
      content={
        <VStack align="start" gap={0.5} paddingY={0.5}>
          {models.map((m) => (
            <Text key={m} textStyle="xs" fontFamily="mono">
              {m}
            </Text>
          ))}
        </VStack>
      }
    >
      <Badge size={size} variant="outline" cursor="help">
        +{models.length}
      </Badge>
    </Tooltip>
  );
}

export const ModelCell = {
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
    const rest = row.models.slice(1);
    return (
      <HStack gap={1}>
        <MonoCell truncate whiteSpace={undefined}>
          {primary}
        </MonoCell>
        {rest.length > 0 && <ExtraModelsBadge models={rest} size="xs" />}
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
    const rest = row.models.slice(1);
    return (
      <HStack gap={2}>
        <Text textStyle="sm" color="fg.muted" fontFamily="mono" truncate>
          {primary}
        </Text>
        {rest.length > 0 && <ExtraModelsBadge models={rest} size="sm" />}
      </HStack>
    );
  },
} as const satisfies CellDef<TraceListItem>;

import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type { DensityTokens } from "../../../../../hooks/useDensityTokens";
import type { TraceListItem } from "../../../../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatTokens,
} from "../../../../../utils/formatters";
import { truncateText } from "../../../chatContent";
import { MonoCell } from "../../../MonoCell";
import { ROW_STYLES, StatusDot, rowVariantFor } from "../../../StatusRow";
import { Td, Tr } from "../../../TablePrimitives";
import type { TraceGroup } from "../../cells/group/types";
import type { AddonDef } from "../../types";

const INPUT_PREVIEW_LIMIT = 60;

export const GroupTracesAddon: AddonDef<TraceGroup> = {
  id: "group-traces",
  label: "Group traces",
  shouldRender: ({ isExpanded }) => isExpanded,
  render: ({ row, colSpan, density }) => (
    <>
      {row.traces.map((trace) => (
        <GroupedTraceRow
          key={trace.traceId}
          trace={trace}
          groupBy={row.groupBy}
          colCount={colSpan}
          density={density}
        />
      ))}
    </>
  ),
};

interface GroupedTraceRowProps {
  trace: TraceListItem;
  groupBy: TraceGroup["groupBy"];
  colCount: number;
  density: DensityTokens;
}

const GroupedTraceRow: React.FC<GroupedTraceRowProps> = ({
  trace,
  groupBy,
  colCount,
  density,
}) => {
  const { openDrawer, currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;
  const isSelected = selectedTraceId === trace.traceId;
  const variant = rowVariantFor({ isSelected, status: trace.status });
  const style = ROW_STYLES[variant];
  const turnBg = isSelected ? style.bg : "fg/2";
  const inputPreview = trace.input
    ? truncateText({ text: trace.input, limit: INPUT_PREVIEW_LIMIT })
    : null;

  return (
    <Tr
      bg={turnBg}
      borderBottomWidth="1px"
      borderBottomColor="border.muted"
      _hover={{ bg: style.hoverBg }}
      cursor="pointer"
      onClick={() => openDrawer("traceV2Details", { traceId: trace.traceId })}
    >
      <Td
        padding={0}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
        colSpan={colCount}
      >
        <VStack gap={0} align="stretch">
          <HStack
            gap={2}
            paddingX={2}
            paddingLeft={6}
            paddingY={density.rowPaddingY}
          >
            <StatusDot status={trace.status} size="6px" />
            <MonoCell color="fg.subtle" flexShrink={0}>
              {formatRelativeTime(trace.timestamp)}
            </MonoCell>
            <Text
              textStyle="sm"
              fontWeight="500"
              color="fg"
              truncate
              flex={1}
              minWidth={0}
            >
              {trace.name}
            </Text>
            {groupBy !== "service" && trace.serviceName && (
              <MonoCell color="fg.subtle" flexShrink={0}>
                {trace.serviceName}
              </MonoCell>
            )}
            <MonoCell flexShrink={0}>
              {formatDuration(trace.durationMs)}
            </MonoCell>
            <MonoCell flexShrink={0}>
              {formatCost(trace.totalCost, trace.tokensEstimated)}
            </MonoCell>
            {groupBy !== "model" && trace.models[0] && (
              <MonoCell flexShrink={0}>
                {abbreviateModel(trace.models[0])}
              </MonoCell>
            )}
            {trace.totalTokens > 0 && (
              <MonoCell color="fg.subtle" flexShrink={0}>
                {formatTokens(trace.totalTokens)}
              </MonoCell>
            )}
          </HStack>
          {inputPreview && (
            <Text
              textStyle="xs"
              color="fg.subtle"
              truncate
              paddingLeft={10}
              paddingRight={2}
              paddingBottom={density.rowPaddingY}
            >
              {inputPreview}
            </Text>
          )}
        </VStack>
      </Td>
    </Tr>
  );
};

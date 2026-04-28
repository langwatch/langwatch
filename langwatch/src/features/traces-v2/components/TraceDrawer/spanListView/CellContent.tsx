import { Circle, Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration, STATUS_COLORS } from "../../../utils/formatters";
import { SpanTypeBadge } from "./SpanTypeBadge";
import type { DerivedSpan, SortField } from "./types";
import { formatOffset } from "./utils";

export function CellContent({
  col,
  data,
}: {
  col: SortField;
  data: DerivedSpan;
}) {
  switch (col) {
    case "name":
      return (
        <Text
          textStyle="xs"
          fontFamily="mono"
          truncate
          title={data.span.name}
          color="fg"
        >
          {data.span.name}
        </Text>
      );
    case "type":
      return <SpanTypeBadge type={data.span.type ?? "span"} />;
    case "duration":
      return (
        <Text textStyle="xs" fontFamily="mono" color="fg.muted">
          {data.duration === 0 ? "<1ms" : formatDuration(data.duration)}
        </Text>
      );
    case "model":
      return (
        <Text
          textStyle="xs"
          truncate
          color="fg.muted"
          title={data.span.model ?? undefined}
        >
          {data.span.model ? data.span.model.split("/").pop() : "\u2014"}
        </Text>
      );
    case "status": {
      const statusColor =
        (STATUS_COLORS[data.span.status] as string) ?? "gray.solid";
      return (
        <Tooltip
          content={data.span.status.toUpperCase()}
          positioning={{ placement: "top" }}
        >
          <Circle size="8px" bg={statusColor} />
        </Tooltip>
      );
    }
    case "start":
      return (
        <Text textStyle="xs" fontFamily="mono" color="fg.subtle">
          {formatOffset(data.startOffset)}
        </Text>
      );
    default:
      return null;
  }
}

export function FooterCell({
  field,
  totals,
  isFiltered,
}: {
  field: SortField;
  totals: {
    duration: number;
  };
  isFiltered: boolean;
}) {
  switch (field) {
    case "name":
      return (
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
          {isFiltered ? "Filtered totals:" : "Totals:"}
        </Text>
      );
    case "duration":
      return (
        <Tooltip
          content={isFiltered ? "Sum of filtered spans" : "Trace duration"}
          positioning={{ placement: "top" }}
        >
          <Text
            textStyle="xs"
            fontWeight="semibold"
            fontFamily="mono"
            color="fg.muted"
          >
            {totals.duration === 0 ? "<1ms" : formatDuration(totals.duration)}
            {!isFiltered && "*"}
          </Text>
        </Tooltip>
      );
    default:
      return null;
  }
}

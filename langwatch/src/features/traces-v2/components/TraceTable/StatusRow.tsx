import { Box, HStack, type SystemStyleObject, Text } from "@chakra-ui/react";
import type React from "react";
import type { TraceStatus } from "../../types/trace";
import { Tbody } from "./TablePrimitives";

type Color = NonNullable<SystemStyleObject["color"]>;

export type RowVariant = "selected" | "error" | "warning" | "default";

export interface RowStyle {
  borderColor: Color;
  bg: Color;
  hoverBg: Color;
  /**
   * Per-cell vertical separator + row bottom border. Defaults to
   * Chakra's subtle border tokens; error/warning variants tint it so
   * the row separators stay visible against the red/yellow tinted bg
   * (otherwise the grey separators get washed out and adjacent error
   * rows visually melt into each other).
   */
  separatorColor: Color;
  /** Slightly stronger separator for the row's bottom border. */
  bottomSeparatorColor: Color;
}

export const ROW_STYLES: Record<RowVariant, RowStyle> = {
  selected: {
    borderColor: "blue.fg",
    bg: "blue.fg/8",
    hoverBg: "blue.fg/10",
    separatorColor: "border.subtle",
    bottomSeparatorColor: "border.muted",
  },
  error: {
    borderColor: "red.fg",
    bg: "red.fg/3",
    hoverBg: "red.fg/8",
    separatorColor: "red.fg/5",
    bottomSeparatorColor: "red.fg/6",
  },
  warning: {
    borderColor: "yellow.fg",
    bg: "yellow.fg/3",
    hoverBg: "yellow.fg/8",
    separatorColor: "yellow.fg/5",
    bottomSeparatorColor: "yellow.fg/6",
  },
  default: {
    borderColor: "transparent",
    bg: "transparent",
    // Light blue tint on hover so the row hover state reads as a
    // deliberate selection cue rather than a faint grey wash. Matches
    // the selected-row tint (blue.fg/8) but lighter so hover doesn't
    // get mistaken for selection.
    hoverBg: "blue.fg/5",
    separatorColor: "border.subtle",
    bottomSeparatorColor: "border.muted",
  },
};

export function rowVariantFor({
  isSelected,
  status,
}: {
  isSelected: boolean;
  status: TraceStatus;
}): RowVariant {
  if (isSelected) return "selected";
  if (status === "error") return "error";
  if (status === "warning") return "warning";
  return "default";
}

interface StatusRowGroupProps {
  style: RowStyle;
  onClick?: (e: React.MouseEvent) => void;
  traceId?: string;
  isNew?: boolean;
  children: React.ReactNode;
  ref?: React.Ref<HTMLTableSectionElement>;
  /** Set by virtualizer; used by `measureElement` to look up the row index. */
  "data-index"?: number;
}

export const StatusRowGroup: React.FC<StatusRowGroupProps> = ({
  style,
  onClick,
  traceId,
  isNew = false,
  children,
  ref,
  "data-index": dataIndex,
}) => (
  <Tbody
    ref={ref}
    data-index={dataIndex}
    onClick={onClick}
    data-trace-id={traceId}
    data-new={isNew ? "true" : undefined}
    css={{
      "& > tr > td": { transition: "none" },
      // Reveal `data-row-hover-reveal` children for the WHOLE row group
      // — the main row AND any addon rows (IO preview, etc.). Without
      // this, hovering the input/output addon row didn't reveal the
      // trace ID because the rule lived on the main <Tr> only.
      "&:hover [data-row-hover-reveal]": { opacity: 1 },
      ...(isNew && {
        "& > tr > td": {
          transition: "none",
          animation: "tracesV2RowNew 3s ease-out",
        },
        "@keyframes tracesV2RowNew": {
          "0%": { backgroundColor: "rgba(59, 130, 246, 0.22)" },
          "18%": { backgroundColor: "rgba(59, 130, 246, 0.06)" },
          "36%": { backgroundColor: "rgba(59, 130, 246, 0.18)" },
          "54%": { backgroundColor: "rgba(59, 130, 246, 0.05)" },
          "72%": { backgroundColor: "rgba(59, 130, 246, 0.12)" },
          "100%": { backgroundColor: "transparent" },
        },
      }),
    }}
    _hover={{
      "& > tr > td": { bg: style.hoverBg },
    }}
  >
    {children}
  </Tbody>
);

// Light mode steps the dot up to `.solid` so the indicator reads as the
// same saturated tone the filter sidebar uses for its status legend. The
// `.fg` token rendered too dark on the white table surface. Dark mode
// keeps `.fg` because against the dark canvas the solid step over-pops.
const STATUS_COLORS: Record<TraceStatus, Color> = {
  error: { base: "red.solid", _dark: "red.fg" },
  warning: { base: "yellow.solid", _dark: "yellow.fg" },
  ok: { base: "green.solid", _dark: "green.fg" },
};

export const StatusDot: React.FC<{ status: TraceStatus; size?: string }> = ({
  status,
  size = "7px",
}) => (
  <Box
    width={size}
    height={size}
    borderRadius="full"
    bg={STATUS_COLORS[status]}
    flexShrink={0}
  />
);

const STATUS_LABELS: Record<TraceStatus, string> = {
  error: "Error",
  warning: "Warn",
  ok: "OK",
};

export const StatusIndicator: React.FC<{ status: TraceStatus }> = ({
  status,
}) => (
  <HStack gap={1}>
    <StatusDot status={status} />
    <Text textStyle="xs" color="fg.muted">
      {STATUS_LABELS[status]}
    </Text>
  </HStack>
);

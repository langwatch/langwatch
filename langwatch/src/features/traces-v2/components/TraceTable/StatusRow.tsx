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
    // Light blue surface tint for the active row — Chakra's
    // `blue.subtle` semantic token, matches what the docs use for
    // selected list items. Reads naturally against the white table.
    bg: "blue.subtle",
    hoverBg: "blue.subtle",
    separatorColor: "border.subtle",
    bottomSeparatorColor: "border.muted",
  },
  error: {
    // Was `red.fg/3` — invisible at table thumbnail width and indistinguishable
    // from `default` for most viewers, so an "All" lens with a handful of
    // failing traces read as healthy. Bumped to `/8` so an error row reads as
    // "something's wrong here" without crossing into "this row is selected"
    // territory (selected uses `blue.subtle` ≈ /15 worth of weight). Hover
    // bumps to `/14` so the row still lifts on cursor-over without saturating.
    borderColor: "red.fg",
    bg: "red.fg/8",
    hoverBg: "red.fg/14",
    separatorColor: "red.fg/10",
    bottomSeparatorColor: "red.fg/12",
  },
  warning: {
    // Matched bump for parity — warning rows had the same invisibility issue.
    borderColor: "yellow.fg",
    bg: "yellow.fg/8",
    hoverBg: "yellow.fg/14",
    separatorColor: "yellow.fg/10",
    bottomSeparatorColor: "yellow.fg/12",
  },
  default: {
    borderColor: "transparent",
    bg: "transparent",
    // Light grey tint on hover — same `gray.subtle` token the Model
    // column badge uses, so hover reads as "highlighted, not yet
    // selected" while the selected state owns the `blue.subtle` tint.
    hoverBg: "gray.subtle",
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
  /**
   * The resolved row variant. Surfaced as a `data-row-variant` attribute
   * on the tbody so per-variant CSS (e.g. the sticky-first-column rule
   * in TraceTableShell) can stay in sync with whatever colour the row
   * itself is painting.
   */
  variant: RowVariant;
  onClick?: (e: React.MouseEvent) => void;
  traceId?: string;
  isNew?: boolean;
  /**
   * When true, play a brief in-place update pulse animation. Used when
   * an SSE event arrives for a row that's already visible — the row data
   * was updated in the cache directly, so we don't need to refetch the
   * list; just signal that something changed. Distinct from `isNew`
   * (which fires for rows that just arrived in the viewport after a list
   * invalidation). Both can be true simultaneously.
   */
  isPulsing?: boolean;
  children: React.ReactNode;
  ref?: React.Ref<HTMLTableSectionElement>;
  /** Set by virtualizer; used by `measureElement` to look up the row index. */
  "data-index"?: number;
}

export const StatusRowGroup: React.FC<StatusRowGroupProps> = ({
  style,
  variant,
  onClick,
  traceId,
  isNew = false,
  isPulsing = false,
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
    data-pulsing={isPulsing ? "true" : undefined}
    data-row-variant={variant}
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
      ...(isPulsing &&
        !isNew && {
          // Subtle single-flash pulse for in-place row updates. Lighter
          // than the `isNew` animation — the row isn't new, it just
          // changed. One brief blue highlight to catch the eye without
          // strobing.
          "& > tr > td": {
            transition: "none",
            animation: "tracesV2RowPulse 1.2s ease-out",
          },
          "@keyframes tracesV2RowPulse": {
            "0%": { backgroundColor: "rgba(59, 130, 246, 0.14)" },
            "40%": { backgroundColor: "rgba(59, 130, 246, 0.06)" },
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

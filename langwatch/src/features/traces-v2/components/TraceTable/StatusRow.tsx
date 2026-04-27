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
}

export const ROW_STYLES: Record<RowVariant, RowStyle> = {
  selected: {
    borderColor: "blue.fg",
    bg: "blue.fg/8",
    hoverBg: "blue.fg/10",
  },
  error: {
    borderColor: "red.fg",
    bg: "red.fg/3",
    hoverBg: "red.fg/8",
  },
  warning: {
    borderColor: "yellow.fg",
    bg: "yellow.fg/3",
    hoverBg: "yellow.fg/8",
  },
  default: {
    borderColor: "transparent",
    bg: "transparent",
    hoverBg: "fg.subtle/6",
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
}

export const StatusRowGroup: React.FC<StatusRowGroupProps> = ({
  style,
  onClick,
  traceId,
  isNew = false,
  children,
}) => (
  <Tbody
    onClick={onClick}
    data-trace-id={traceId}
    data-new={isNew ? "true" : undefined}
    css={{
      "& > tr > td": { transition: "none" },
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

const STATUS_COLORS: Record<TraceStatus, Color> = {
  error: "red.fg",
  warning: "yellow.fg",
  ok: "green.fg",
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

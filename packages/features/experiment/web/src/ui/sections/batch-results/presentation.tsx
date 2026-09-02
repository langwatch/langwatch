import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { format, formatDistanceToNow } from "date-fns";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Formatter,
  NameType,
  Payload,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import type {
  BatchEvaluatorResult,
  BatchTargetOutput,
} from "../batch-evaluation-results.types";

export type BatchCellFailure = {
  title: string;
  description: string;
  raw?: string;
};

export type DescribeBatchCellFailure = (input: {
  error: string | null;
  domainError: BatchTargetOutput["domainError"];
}) => BatchCellFailure | null;

export type RenderBatchEvaluatorResult = (input: {
  result: BatchEvaluatorResult;
}) => ReactNode;

export type RenderTracePeek = (input: { traceId: string }) => ReactNode;

export type RenderDatasetImage = (input: { src: string }) => ReactNode;

export const RUN_COLORS = [
  "#3b82f6",
  "#dd6b20",
  "#38a169",
  "#d53f8c",
  "#805ad5",
  "#e53e3e",
  "#319795",
  "#718096",
] as const;

export const formatScore = (score: number | null): string =>
  score === null ? "-" : score.toFixed(2);

export const formatCost = (cost: number | null): string => {
  if (cost === null) return "-";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

export const formatLatency = (latencyMs: number | null): string => {
  if (latencyMs === null) return "-";
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`;
  return `${(latencyMs / 1000).toFixed(1)}s`;
};

export const formatTimeAgo = (
  timestamp: number,
  dateFormat = "dd/MMM HH:mm",
  maxHours = 24,
): string | undefined => {
  if (!timestamp) return undefined;

  const date = new Date(timestamp);
  const now = new Date();
  const hoursDiff = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (hoursDiff < maxHours) {
    return formatDistanceToNow(date, { addSuffix: true });
  }

  return format(date, dateFormat);
};

const isSingleOutputKey = (output: object): output is { output: unknown } => {
  const keys = Object.keys(output);
  return keys.length === 1 && keys[0] === "output";
};

export const formatTargetOutput = (output: unknown): string => {
  if (output === null || output === undefined) return "";
  if (typeof output !== "object") return String(output);
  if (Array.isArray(output)) return JSON.stringify(output, null, 2);

  if (isSingleOutputKey(output)) {
    const content = output.output;
    if (content === null || content === undefined) return "";
    return typeof content === "object"
      ? JSON.stringify(content, null, 2)
      : String(content);
  }

  return JSON.stringify(output, null, 2);
};

export const getImageUrl = (value: unknown): string | null => {
  if (!value) return null;

  const source = String(value).trim();
  const markdown = source.match(/^!\[.*?\]\((.*?)\)$/);
  if (markdown?.[1]) return markdown[1];

  if (source.startsWith("data:image/")) {
    return /^data:image\/(jpeg|jpg|gif|png|webp|svg\+xml|bmp);base64,/i.test(source)
      ? source
      : null;
  }

  try {
    const url = new URL(source);
    if (/\.(jpeg|jpg|gif|png|webp|svg|bmp)(\?.*)?$/i.test(source)) return source;

    const isGoogleImageHost =
      url.hostname === "gstatic.com" ||
      url.hostname.endsWith(".gstatic.com") ||
      url.hostname === "googleusercontent.com" ||
      url.hostname.endsWith(".googleusercontent.com");
    if (isGoogleImageHost) return source;

    if (url.pathname.length <= 30) return null;
    if (/image|img|photo|pic|picture|media|content|upload/i.test(url.pathname)) {
      return source;
    }

    const segment = url.pathname.split("/").at(-1);
    return segment && segment.length > 50 && /^[A-Za-z0-9+/=]+$/.test(segment)
      ? source
      : null;
  } catch {
    return null;
  }
};

const COLOR_NAMES = [
  "orange",
  "blue",
  "green",
  "yellow",
  "purple",
  "teal",
  "cyan",
  "pink",
] as const;

export const getColorForString = (_set: "colors", value: string) => {
  let sum = 0;
  for (const char of value) sum += char.charCodeAt(0);

  const color = COLOR_NAMES[sum % COLOR_NAMES.length] ?? "gray";
  return { background: `${color}.subtle`, color: `${color}.emphasized` };
};

export const disambiguateNames = (names: string[]): string[] => {
  const occurrences = new Map<string, number>();
  for (const name of names) {
    if (name) occurrences.set(name, (occurrences.get(name) ?? 0) + 1);
  }

  const numbered = new Map<string, number>();
  return names.map((name) => {
    if (!name || (occurrences.get(name) ?? 0) < 2) return name;

    const ordinal = (numbered.get(name) ?? 0) + 1;
    numbered.set(name, ordinal);
    return `${name} (${ordinal})`;
  });
};

export const useEscapeKey = ({
  enabled,
  onEscape,
}: {
  enabled: boolean;
  onEscape: () => void;
}): void => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onEscape]);
};

export const useInteractiveTooltip = (closeDelay = 150) => {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimeout();
    setIsOpen(true);
  }, [clearCloseTimeout]);

  const handleMouseLeave = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => setIsOpen(false), closeDelay);
  }, [clearCloseTimeout, closeDelay]);

  return { isOpen, handleMouseEnter, handleMouseLeave };
};

export const getPassRateGradientColor = (passRate: number | null): string => {
  if (passRate === null) return "gray.400";

  const rate = Math.max(0, Math.min(100, passRate));
  if (rate <= 50) {
    const ratio = rate / 50;
    return `rgb(${Math.round(239 + 6 * ratio)}, ${Math.round(68 + 90 * ratio)}, ${Math.round(68 - 57 * ratio)})`;
  }

  const ratio = (rate - 50) / 50;
  return `rgb(${Math.round(245 - 211 * ratio)}, ${Math.round(158 + 39 * ratio)}, ${Math.round(11 + 83 * ratio)})`;
};

export const PassRateCircle = ({
  passRate,
  size = "10px",
}: {
  passRate: number | null;
  size?: string;
}) => (
  <Box
    borderRadius="full"
    width={size}
    height={size}
    bg={getPassRateGradientColor(passRate)}
  />
);

export const MetricStatsTooltip = ({
  stats,
  formatValue,
}: {
  stats: {
    min: number | null;
    avg: number | null;
    median: number | null;
    p75: number | null;
    p90: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
    total: number | null;
    count: number;
  };
  formatValue: (value: number | null) => string;
}) => {
  const rows: Array<{ label: string; value: number | null }> = [
    { label: "Min", value: stats.min },
    { label: "Avg", value: stats.avg },
    { label: "Median (p50)", value: stats.median },
    { label: "p75", value: stats.p75 },
    { label: "p90", value: stats.p90 },
    { label: "p95", value: stats.p95 },
    { label: "p99", value: stats.p99 },
    { label: "Max", value: stats.max },
  ];

  return (
    <VStack align="stretch" gap={1} fontSize="11px" minWidth="140px">
      {rows.map(({ label, value }) => (
        <HStack key={label} justify="space-between">
          <Text color="fg.muted">{label}</Text>
          <Text>{formatValue(value)}</Text>
        </HStack>
      ))}
      <Box borderTopWidth="1px" borderColor="border.emphasized" marginY={1} />
      <HStack justify="space-between">
        <Text color="fg.muted">Total</Text>
        <Text fontWeight="medium">{formatValue(stats.total)}</Text>
      </HStack>
      <HStack justify="space-between">
        <Text color="fg.muted">Count</Text>
        <Text>{stats.count}</Text>
      </HStack>
    </VStack>
  );
};

export const ChartTooltip = ({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  separator = ": ",
}: {
  active?: boolean;
  payload?: ReadonlyArray<Payload<ValueType, NameType>>;
  label?: string | number;
  formatter?: Formatter<ValueType, NameType>;
  labelFormatter?: (
    label: string | number | undefined,
    payload: ReadonlyArray<Payload<ValueType, NameType>>,
  ) => ReactNode;
  separator?: string;
}) => {
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter ? labelFormatter(label, payload) : label;

  return (
    <Box
      bg="bg.panel/85"
      backdropFilter="blur(8px)"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      px={3}
      py={2}
      boxShadow="lg"
    >
      {formattedLabel != null && formattedLabel !== "" && (
        <Text textStyle="xs" color="fg.muted" fontWeight="medium" mb={1}>
          {formattedLabel}
        </Text>
      )}
      <VStack gap={0.5} align="start">
        {payload
          .filter((entry) => !entry.hide)
          .map((entry, index) => {
            let displayValue: ReactNode = entry.value;
            let displayName: ReactNode = entry.name;

            if (formatter && entry.value != null) {
              const formatted = formatter(entry.value, entry.name, entry, index, payload);
              if (Array.isArray(formatted)) {
                displayValue = formatted[0];
                if (formatted[1] != null) displayName = formatted[1];
              } else {
                displayValue = formatted;
              }
            }

            return (
              <HStack key={index} gap={1.5} align="center">
                <Box
                  width="8px"
                  height="8px"
                  borderRadius="2px"
                  flexShrink={0}
                  style={{ backgroundColor: entry.color }}
                />
                <Text textStyle="xs" color="fg">
                  <Text as="span" color="fg.muted">
                    {displayName}
                  </Text>
                  {separator}
                  {displayValue}
                </Text>
              </HStack>
            );
          })}
      </VStack>
    </Box>
  );
};

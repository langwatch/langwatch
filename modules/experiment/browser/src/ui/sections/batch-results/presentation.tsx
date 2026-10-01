import { isImageAttachmentRef } from "@langwatch/dataset-contract";
import { Box } from "@langwatch/design-system/primitives";
import { format, formatDistanceToNow, nowInstant } from "@langwatch/time";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { readableDate } from "../../../model/display-formatters.ts";
import type { BatchEvaluatorResult, BatchTargetOutput } from "../batch-evaluation-results.types.ts";

export type BatchCellFailure = {
  title: string;
  description: string;
  raw?: string;
};

export type DescribeBatchCellFailure = (input: {
  error: string | null;
  domainError: BatchTargetOutput["domainError"];
}) => BatchCellFailure | null;

export type RenderBatchEvaluatorResult = (input: { result: BatchEvaluatorResult }) => ReactNode;

export type RenderTracePeek = (input: { traceId: string }) => ReactNode;

export type RenderDatasetImage = (input: { src: string }) => ReactNode;

export const formatScore = (score: number | null): string =>
  score === null ? "-" : score.toFixed(2);

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

  const date = readableDate(timestamp);
  const now = nowInstant();
  const hoursDiff = (now.epochMilliseconds - date.getTime()) / (1000 * 60 * 60);

  if (hoursDiff < maxHours) {
    return formatDistanceToNow(date, { addSuffix: true });
  }

  return format(date, dateFormat);
};

export const getImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;

  const source = value.trim();
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
    return segment && segment.length > 50 && /^[A-Za-z0-9+/=]+$/.test(segment) ? source : null;
  } catch {
    return null;
  }
};

/**
 * The address a result cell renders as a picture: a picture URL, or an uploaded
 * dataset attachment whose name ends in a picture ending. Any other value,
 * strings or not, answers null. @see specs/datasets/dataset-attachment-cells.feature
 */
export const cellPictureUrl = (value: unknown): string | null => {
  const fromUrl = getImageUrl(value);
  if (fromUrl) return fromUrl;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isImageAttachmentRef(trimmed) ? trimmed : null;
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
  <Box borderRadius="full" width={size} height={size} bg={getPassRateGradientColor(passRate)} />
);

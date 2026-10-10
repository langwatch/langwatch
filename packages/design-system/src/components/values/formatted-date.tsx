import { HStack, Text, VStack } from "@chakra-ui/react";
import { Temporal, nowInstant } from "@langwatch/time";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  type InstantDisplay,
  describeInstant,
  formatInstant,
  relativeRefreshMs,
} from "../../describe-instant.ts";
import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";
import { Tooltip } from "../overlays/tooltip.tsx";

/** One row of the hover: a click copies its value. */
function FormatRow({ label, text }: { label: string; text: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <HStack
      asChild
      justify="space-between"
      align="baseline"
      gap={4}
      width="full"
      cursor="copy"
      borderRadius="xs"
      textAlign="start"
      _hover={{ "& [data-value]": { textDecoration: "underline" } }}
      _focusVisible={{ outline: "1px solid", outlineColor: "currentColor" }}
    >
      <button type="button" aria-label={`Copy ${label}: ${text}`} onClick={() => copy(text)}>
        <Text textStyle="2xs">{label}</Text>
        <HStack gap={1} align="center">
          {copied ? <Check size={10} aria-hidden /> : null}
          <Text textStyle="xs" data-value fontVariantNumeric="tabular-nums">
            {copied ? "Copied" : text}
          </Text>
        </HStack>
      </button>
    </HStack>
  );
}

export function DateFormats({
  epochMs,
  sourceTimeZone,
}: {
  epochMs: number;
  sourceTimeZone?: string;
}) {
  const d = describeInstant({ epochMs, sourceTimeZone });
  const rows: [string, string][] = [
    ["When", d.relative],
    [`You (${d.viewer.zone})`, d.viewer.text],
    ["UTC", d.utc],
    ...(d.source ? ([[d.source.zone, d.source.text]] as [string, string][]) : []),
    ["Offset", d.relativeToViewer],
    ["ISO 8601", d.iso],
    ["Unix ms", String(epochMs)],
  ];
  return (
    <VStack align="stretch" gap={0.5} data-testid="date-formats">
      {rows.map(([label, text]) => (
        <FormatRow key={label} label={label} text={text} />
      ))}
    </VStack>
  );
}

const toEpochMs = (value: number | string) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  try {
    return Temporal.Instant.from(value).epochMilliseconds;
  } catch {
    return null;
  }
};

/** The current time, re-read as often as a relative label needs; never when it doesn't. */
function useNowMs({ epochMs, live }: { epochMs: number | null; live: boolean }): number {
  const [nowMs, setNowMs] = useState(() => nowInstant().epochMilliseconds);
  useEffect(() => {
    if (!live || epochMs === null) return;
    const timer = setTimeout(
      () => setNowMs(nowInstant().epochMilliseconds),
      relativeRefreshMs({ epochMs, nowMs }),
    );
    return () => clearTimeout(timer);
  }, [live, epochMs, nowMs]);
  return nowMs;
}

export interface FormattedDateProps {
  value: number | string;
  /** How the label reads; the hover always lists every form. Defaults to `datetime`. */
  display?: InstantDisplay;
  /** The zone the label is drawn in; defaults to the viewer's. */
  timeZone?: string;
  /** Appends the zone's short name to the label, for a time read across zones. */
  showZone?: boolean;
  /** The zone the value was recorded in, listed in the hover beside the viewer's. */
  sourceTimeZone?: string;
  locale?: string;
  /** Replaces the label; the hover still lists every form. */
  children?: ReactNode;
}

/**
 * A date or time in the viewer's zone. A relative label keeps itself current; the
 * hover lists the age, every zone, the offset, ISO and Unix forms, each copied on click.
 */
export function FormattedDate({
  value,
  display = "datetime",
  timeZone,
  showZone,
  sourceTimeZone,
  locale,
  children,
}: FormattedDateProps) {
  const epochMs = toEpochMs(value);
  const nowMs = useNowMs({ epochMs, live: display === "relative" || display === "auto" });
  if (epochMs === null) return <Text as="span">{children ?? "—"}</Text>;
  return (
    <Tooltip
      interactive
      content={<DateFormats epochMs={epochMs} sourceTimeZone={sourceTimeZone} />}
    >
      <Text asChild whiteSpace="nowrap" cursor="help" fontVariantNumeric="tabular-nums">
        <time dateTime={Temporal.Instant.fromEpochMilliseconds(epochMs).toString()}>
          {children ?? formatInstant({ epochMs, display, nowMs, locale, timeZone, showZone })}
        </time>
      </Text>
    </Tooltip>
  );
}

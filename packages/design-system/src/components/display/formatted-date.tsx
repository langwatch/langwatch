import { HStack, Text, VStack } from "@chakra-ui/react";
import { Temporal } from "@langwatch/time";
import type { ReactNode } from "react";

import { describeInstant } from "../../describe-instant.ts";
import { Tooltip } from "../overlays/tooltip.tsx";

export function DateFormats({
  epochMs,
  sourceTimeZone,
}: {
  epochMs: number;
  sourceTimeZone?: string;
}) {
  const d = describeInstant({ epochMs, sourceTimeZone });
  const rows: [string, string][] = [
    [`You (${d.viewer.zone})`, d.viewer.text],
    ["UTC", d.utc],
    ...(d.source ? ([[d.source.zone, d.source.text]] as [string, string][]) : []),
    ["Offset", d.relativeToViewer],
    ["When", d.relative],
  ];
  return (
    <VStack align="stretch" gap={0.5} data-testid="date-formats">
      {rows.map(([label, text]) => (
        <HStack key={label} justify="space-between" gap={4} align="baseline">
          <Text textStyle="2xs">{label}</Text>
          <Text textStyle="xs">{text}</Text>
        </HStack>
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

/** A date or time with its zones, offset from the viewer and relative age on hover. */
export function FormattedDate({
  value,
  sourceTimeZone,
  children,
}: {
  value: number | string;
  sourceTimeZone?: string;
  children?: ReactNode;
}) {
  const epochMs = toEpochMs(value);
  if (epochMs === null) return <Text as="span">{children ?? "—"}</Text>;
  return (
    <Tooltip content={<DateFormats epochMs={epochMs} sourceTimeZone={sourceTimeZone} />}>
      <Text as="span" whiteSpace="nowrap" cursor="help">
        {children ??
          new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
            epochMs,
          )}
      </Text>
    </Tooltip>
  );
}

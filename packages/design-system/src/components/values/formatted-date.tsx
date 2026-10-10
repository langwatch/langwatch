import {
  Box,
  Grid,
  IconButton,
  Separator,
  Text,
  VStack,
  VisuallyHidden,
  chakra,
} from "@chakra-ui/react";
import { Temporal, nowInstant } from "@langwatch/time";
import { Check, Copy } from "lucide-react";
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

/** One row of the card: a plain label, the exact value (never cut), a copy button. */
function FormatRow({
  label,
  value,
  subline,
  copyText,
  mono,
}: {
  label: string;
  value: ReactNode;
  subline?: string;
  copyText: string;
  mono?: boolean;
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Grid
      templateColumns="64px minmax(0, 1fr) 28px"
      columnGap={2}
      alignItems="start"
      textStyle="xs"
      lineHeight="18px"
    >
      <Text as="span" color="fg.muted" paddingTop="5px">
        {label}
      </Text>
      <Box paddingTop="5px" minWidth={0}>
        <Text
          color="fg"
          fontFamily={mono ? "mono" : void 0}
          fontVariantNumeric="tabular-nums"
          wordBreak="break-all"
        >
          {value}
        </Text>
        {subline && <Text color="fg.muted">{subline}</Text>}
      </Box>
      <IconButton
        size="2xs"
        boxSize="7"
        minWidth="7"
        variant="ghost"
        color={copied ? "fg.success" : "fg.muted"}
        aria-label={`Copy ${label}: ${copyText}`}
        onClick={() => copy(copyText)}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </IconButton>
      <VisuallyHidden aria-live="polite">{copied ? "Copied" : ""}</VisuallyHidden>
    </Grid>
  );
}

const UTC_ZONE = /^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu)$/;
const sameZone = (a: string, b: string) => a === b || (UTC_ZONE.test(a) && UTC_ZONE.test(b));

export function DateFormats({
  epochMs,
  sourceTimeZone,
  timeZone,
  locale,
  nowMs,
}: {
  epochMs: number;
  sourceTimeZone?: string;
  /** The zone the trigger is drawn in; the "Local" row reads in it. */
  timeZone?: string;
  locale?: string;
  nowMs?: number;
}) {
  const d = describeInstant({
    epochMs,
    nowMs,
    locale,
    sourceTimeZone,
    ...(timeZone ? { viewerTimeZone: timeZone } : {}),
  });
  const local = d.viewer;
  const source = d.source && !sameZone(d.source.zone, local.zone) ? d.source : null;
  const showUtc = !sameZone(local.zone, "UTC");
  const reading = (parts: { date: string; clock: string }) => `${parts.date}  ${parts.clock}`;
  return (
    <VStack align="stretch" gap={2} data-testid="date-formats">
      <Box>
        <Text fontSize="13px" lineHeight="20px" fontWeight="medium" color="fg">
          {d.heading}
        </Text>
        <Text textStyle="xs" lineHeight="18px" color="fg.muted">
          {d.relative}
        </Text>
      </Box>
      <Separator />
      <VStack align="stretch" gap={1}>
        <FormatRow
          label="Local"
          value={reading(local)}
          subline={`${local.zone} · ${local.offset}`}
          copyText={`${local.date} ${local.clock} ${local.zone} (${local.offset})`}
        />
        {source && (
          <FormatRow
            label="Source timezone"
            value={reading(source)}
            subline={`${source.zone} · ${source.offset} · ${d.relativeToViewer}`}
            copyText={`${source.date} ${source.clock} ${source.zone} (${source.offset})`}
          />
        )}
        {showUtc && (
          <FormatRow
            label="UTC"
            value={reading(d.utcParts)}
            copyText={`${d.utcParts.date} ${d.utcParts.clock} UTC`}
          />
        )}
      </VStack>
      <Separator />
      <VStack align="stretch" gap={1}>
        <FormatRow label="ISO 8601" value={d.iso} copyText={d.iso} mono />
        <FormatRow label="Unix ms" value={String(epochMs)} copyText={String(epochMs)} mono />
      </VStack>
    </VStack>
  );
}

/** The hover reads as an opaque card on the page, not a dark tooltip. */
const CARD = {
  bg: "bg.panel",
  color: "fg",
  borderWidth: "1px",
  borderColor: "border",
  boxShadow: "md",
  borderRadius: "6px",
  padding: "12px",
  width: "400px",
  maxWidth: "calc(100vw - 24px)",
} as const;

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
    if (live) setNowMs(nowInstant().epochMilliseconds);
  }, [live]);
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

const UNDERLINE = {
  textDecoration: "underline dotted",
  textDecorationColor: "fg.subtle",
  textUnderlineOffset: "3px",
} as const;

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
  /** Adds seconds to the label's time, for a log read to the second. */
  seconds?: boolean;
  /** Replaces the label; the hover still lists every form. */
  children?: ReactNode;
}

/**
 * A date or time in the viewer's zone, focusable. A relative label keeps itself current;
 * the hover card lists the age, every zone with its offset, ISO and Unix, each copyable.
 */
export function FormattedDate({
  value,
  display = "datetime",
  timeZone,
  showZone,
  sourceTimeZone,
  locale,
  seconds,
  children,
}: FormattedDateProps) {
  const [open, setOpen] = useState(false);
  const epochMs = toEpochMs(value);
  const nowMs = useNowMs({ epochMs, live: open || display === "relative" || display === "auto" });
  if (epochMs === null) return <Text as="span">{children ?? "—"}</Text>;
  return (
    <Tooltip
      interactive
      openDelay={250}
      closeDelay={300}
      closeOnClick={false}
      closeOnPointerDown={false}
      onOpenChange={(details) => setOpen(details.open)}
      contentProps={CARD}
      content={
        <DateFormats
          epochMs={epochMs}
          sourceTimeZone={sourceTimeZone}
          timeZone={timeZone}
          locale={locale}
          nowMs={nowMs}
        />
      }
    >
      <chakra.button
        type="button"
        display="inline"
        padding={0}
        border={0}
        bg="transparent"
        color="inherit"
        font="inherit"
        textAlign="inherit"
        whiteSpace="nowrap"
        cursor="help"
        fontVariantNumeric="tabular-nums"
        borderRadius="xs"
        _hover={UNDERLINE}
        _focusVisible={{
          ...UNDERLINE,
          outline: "2px solid",
          outlineColor: "colorPalette.focusRing",
        }}
      >
        <time dateTime={Temporal.Instant.fromEpochMilliseconds(epochMs).toString()}>
          {children ??
            formatInstant({ epochMs, display, nowMs, locale, timeZone, showZone, seconds })}
        </time>
      </chakra.button>
    </Tooltip>
  );
}

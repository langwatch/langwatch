import {
  Box,
  chakra,
  Grid,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useRouter } from "~/utils/compat/next-router";
import { LangyPanelSurface } from "~/features/asaplangy";
import type { StatusCell } from "../types";

/**
 * The project's numbers, reframed as status, on the SAME Langy surface as the
 * briefing so the home reads as one material instead of a warm card floating
 * over a flat one.
 *
 * It leads with what LangWatch is uniquely built to surface — pass rate,
 * regressions, failing evals — coloured by whether they need the reader, then
 * demotes the table-stakes metrics (latency, cost, trace counts) to a quieter
 * second row. Serif title, mono tabular figures: the marketing brand, carried
 * across the login line.
 */

const SERIF =
  'var(--langy-font-serif, "Sentient", "Charter", "Source Serif Pro", Georgia, serif)';

export function HomeOverviewCard({
  cells,
  title = "Traces overview",
  rangeLabel,
  dashboardsHref,
  isLoading = false,
  refreshing = false,
  bare = false,
}: {
  cells: StatusCell[];
  title?: string;
  rangeLabel?: string;
  dashboardsHref?: string;
  /** The analytics roll-up hasn't landed yet: show a skeleton grid, not null. */
  isLoading?: boolean;
  /** A background refetch is in flight: show a subtle hint, never a skeleton swap. */
  refreshing?: boolean;
  /**
   * Render as a SECTION of an existing Langy sheet rather than a card of its
   * own: no surface, and a mono section label (the receipts' voice) instead of
   * a second serif display line — the sheet keeps exactly one.
   */
  bare?: boolean;
}) {
  const router = useRouter();
  // Nothing to show and nothing coming — stay out of the way. But while the
  // analytics read is still in flight on first paint, hold the card with a
  // skeleton so it doesn't pop in late and shove the page down.
  if (cells.length === 0 && !isLoading) return null;

  const onDashboards = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!dashboardsHref) return;
    event.preventDefault();
    void router.push(dashboardsHref);
  };

  const content = (
    <VStack align="stretch" gap={bare ? 3.5 : 5}>
      <HStack justify="space-between" align="baseline" gap={3} wrap="wrap">
        <HStack gap={2.5} align="baseline">
          {bare ? (
            <Text
              fontFamily="mono"
              fontSize="10px"
              fontWeight="500"
              letterSpacing="0.03em"
              textTransform="uppercase"
              color="fg.muted"
            >
              {title}
              {rangeLabel ? ` · ${rangeLabel}` : null}
            </Text>
          ) : (
            <>
              <Text
                fontFamily={SERIF}
                fontSize="18px"
                fontWeight="500"
                letterSpacing="-0.01em"
                color="fg"
              >
                {title}
              </Text>
              {rangeLabel ? (
                <Text
                  fontFamily="mono"
                  fontSize="11px"
                  letterSpacing="0.02em"
                  color="fg.subtle"
                >
                  {rangeLabel}
                </Text>
              ) : null}
            </>
          )}
          {refreshing || isLoading ? (
            // Wordless live indicator: a small amber breath beside the label
            // while fresh figures are in flight — the cells' own change-pulse
            // does the announcing when something actually moved.
            <motion.span
              aria-hidden
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                borderRadius: "9999px",
                background: "#ED8926",
              }}
            />
          ) : null}
        </HStack>
        {dashboardsHref ? (
          <chakra.a
            href={dashboardsHref}
            onClick={onDashboards}
            fontFamily="mono"
            fontSize="12px"
            color="orange.fg"
            whiteSpace="nowrap"
            borderBottomWidth="1px"
            borderColor="transparent"
            paddingBottom="1px"
            cursor="pointer"
            transition="border-color 130ms ease"
            _hover={{ borderColor: "orange.fg" }}
          >
            Agent analytics →
          </chakra.a>
        ) : null}
      </HStack>

      <Grid
        // On a wide sheet the figures sit as ONE row of columns (auto-fit),
        // like a newspaper's data strip; on narrow screens they wrap 2-up.
        templateColumns={{
          base: "repeat(2, 1fr)",
          md: "repeat(3, 1fr)",
          lg: "repeat(auto-fit, minmax(150px, 1fr))",
        }}
        columnGap={6}
        rowGap={5}
      >
        {cells.length === 0 && isLoading
          ? Array.from({ length: 6 }, (_, index) => (
              <VStack key={index} align="start" gap={2.5}>
                <Skeleton height="11px" width="72px" />
                <Skeleton height="24px" width="88px" />
              </VStack>
            ))
          : cells.map((cell) => <OverviewCell key={cell.label} cell={cell} />)}
      </Grid>
    </VStack>
  );

  if (bare) return content;

  return (
    <LangyPanelSurface padding={{ base: 4, md: 5 }}>{content}</LangyPanelSurface>
  );
}

/** How long a figure's change-pulse runs. */
const PULSE_MS = 900;
/** A cell pulses at most once per window, however often fresh data lands. */
const PULSE_COOLDOWN_MS = 5_000;

function OverviewCell({ cell }: { cell: StatusCell }) {
  const reduceMotion = useReducedMotion();
  // Live data lands on a poll; when THIS cell's value actually changed, its
  // figure pulses once — an amber breath, not a strobe (cooldown-limited).
  const prevValue = useRef(cell.value);
  const lastPulseAt = useRef(0);
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    if (prevValue.current === cell.value) return;
    prevValue.current = cell.value;
    const now = Date.now();
    if (now - lastPulseAt.current < PULSE_COOLDOWN_MS) return;
    lastPulseAt.current = now;
    setPulseKey((key) => key + 1);
  }, [cell.value]);

  const vanity = cell.tone === "vanity";
  const dot =
    cell.tone === "good"
      ? "green.solid"
      : cell.tone === "bad"
        ? "red.solid"
        : undefined;
  // The figures ARE the content — even the table-stakes ones render in full
  // foreground so the eye lands on the number, not the label. `vanity` keeps
  // only its smaller size and lighter weight.
  const valueColor =
    cell.tone === "good" ? "green.fg" : cell.tone === "bad" ? "red.fg" : "fg";

  return (
    <VStack align="start" gap={2.5}>
      <HStack gap={1.5} align="center">
        {dot ? (
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            background={dot}
            flexShrink={0}
          />
        ) : null}
        <Text
          fontFamily="mono"
          fontSize="11.5px"
          letterSpacing="0.02em"
          color="fg.muted"
        >
          {cell.label}
        </Text>
      </HStack>
      <HStack gap={1.5} align="baseline">
        {/* Keyed remount runs the pulse keyframes once per confirmed change;
            text-shadow inherits, so the amber breath wraps the glyphs. */}
        <motion.span
          key={pulseKey}
          style={{ display: "inline-block" }}
          animate={
            pulseKey > 0 && !reduceMotion
              ? {
                  scale: [1, 1.045, 1],
                  textShadow: [
                    "0 0 0px rgba(237, 137, 38, 0)",
                    "0 0 16px rgba(237, 137, 38, 0.55)",
                    "0 0 0px rgba(237, 137, 38, 0)",
                  ],
                }
              : undefined
          }
          transition={{ duration: PULSE_MS / 1000, ease: "easeOut" }}
        >
          <Text
            fontFamily="mono"
            fontSize={vanity ? "20px" : "26px"}
            fontWeight={vanity ? "400" : "500"}
            letterSpacing="-0.02em"
            lineHeight="1"
            fontVariantNumeric="tabular-nums"
            color={valueColor}
          >
            {cell.value}
          </Text>
        </motion.span>
        {cell.delta ? (
          // Direction spelled three ways at once — arrow, sign, colour — so
          // the period-over-period change reads at a glance.
          <Text
            fontFamily="mono"
            fontSize="11px"
            fontWeight="600"
            fontVariantNumeric="tabular-nums"
            whiteSpace="nowrap"
            color={
              cell.deltaTone === "bad"
                ? "red.fg"
                : cell.deltaTone === "good"
                  ? "green.fg"
                  : "fg.muted"
            }
          >
            {cell.delta.startsWith("+") ? "▲" : "▼"} {cell.delta}
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}

import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TooltipLine } from "./types";

/**
 * Collapsed-sidebar tooltips fire instantly so users running the cursor
 * down the rail get a name on every icon without the default 420ms wait.
 * Active filters keep their detail layout; inactive icons get the label
 * plus a quick-peek of the facet's top values when supplied so the user
 * can scan options without expanding the sidebar.
 */
const INSTANT_OPEN_DELAY_MS = 60;
/**
 * Wait this long after the tooltip opens before swapping the bare label
 * for the values list. Without the delay every cursor-flick along the
 * rail flashed a different list of chips at the user, which read as
 * noise; a short hold lets the eye settle on one icon first and only
 * surfaces the deeper preview if the user is *deliberately* dwelling.
 * The dwell hint ("…") signals "more is coming" so the delay doesn't
 * read as the tooltip being broken.
 */
const VALUES_REVEAL_DELAY_MS = 900;

interface CollapsedFacetIconProps {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  badgeCount?: number;
  tooltipLines: TooltipLine[];
  /**
   * Up to ~5 top values for the facet (categorical only). Rendered as a
   * compact preview list under the label in the tooltip when the icon
   * isn't already showing active filters. Optional — range/attribute
   * icons pass nothing.
   */
  previewValues?: ReadonlyArray<{ value: string; count: number }>;
  onClick: () => void;
}

export const CollapsedFacetIcon: React.FC<CollapsedFacetIconProps> = ({
  icon: Icon,
  label,
  isActive,
  badgeCount,
  tooltipLines,
  previewValues,
  onClick,
}) => {
  // The active-filter tooltip always shows its detail (the user opted
  // in by filtering). For inactive icons with preview values we delay
  // the reveal — see `VALUES_REVEAL_DELAY_MS` for why.
  const hasPreview = !isActive && !!previewValues && previewValues.length > 0;
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [valuesShown, setValuesShown] = useState(false);

  useEffect(() => {
    if (!hasPreview) return;
    if (!tooltipOpen) {
      // Reset on close so the next hover starts the dwell timer fresh
      // instead of revealing values immediately.
      setValuesShown(false);
      return;
    }
    const timer = setTimeout(
      () => setValuesShown(true),
      VALUES_REVEAL_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [hasPreview, tooltipOpen]);

  const content = isActive ? (
    <ActiveTooltip label={label} lines={tooltipLines} />
  ) : hasPreview ? (
    <PreviewTooltip
      label={label}
      values={previewValues!}
      revealed={valuesShown}
    />
  ) : (
    label
  );

  return (
    <Tooltip
      openDelay={INSTANT_OPEN_DELAY_MS}
      open={tooltipOpen}
      onOpenChange={({ open }) => setTooltipOpen(open)}
      content={content}
      positioning={{ placement: "right" }}
    >
      <IconButton
        aria-label={ariaLabelFor({ label, isActive, badgeCount })}
        size="xs"
        variant="ghost"
        color={isActive ? "blue.fg" : "fg.subtle"}
        onClick={onClick}
        position="relative"
      >
        <Icon size={14} />
        {isActive && badgeCount !== undefined && badgeCount > 0 && (
          <CountBadge count={badgeCount} />
        )}
        {isActive && badgeCount === undefined && <ActiveDot />}
      </IconButton>
    </Tooltip>
  );
};

const PreviewTooltip: React.FC<{
  label: string;
  values: ReadonlyArray<{ value: string; count: number }>;
  /**
   * Hide the value rows until the user has dwelled long enough to
   * have actually meant to inspect them — see `VALUES_REVEAL_DELAY_MS`
   * for the rationale. While `revealed` is false we render a tiny
   * pulsing "…" hint so the tooltip doesn't read as a one-line popup
   * with no further depth.
   */
  revealed: boolean;
}> = ({ label, values, revealed }) => (
  <VStack gap={0.5} align="start" maxWidth="220px">
    <Text textStyle="xs" fontWeight="semibold">
      {label}
    </Text>
    {revealed ? (
      <>
        {values.slice(0, 5).map((entry) => (
          <HStack key={entry.value} gap={2} width="full">
            <Text textStyle="2xs" truncate flex={1}>
              {entry.value}
            </Text>
            <Text textStyle="2xs" color="fg.muted">
              {entry.count.toLocaleString()}
            </Text>
          </HStack>
        ))}
        <Text textStyle="2xs" color="fg.subtle" paddingTop={1}>
          Click to expand
        </Text>
      </>
    ) : (
      <Text
        textStyle="2xs"
        color="fg.subtle"
        css={{
          // Soft fade so the hint reads as "more is loading" rather
          // than a stuck dot.
          animation: "tracesFacetDwellPulse 1.4s ease-in-out infinite",
          "@keyframes tracesFacetDwellPulse": {
            "0%, 100%": { opacity: 0.45 },
            "50%": { opacity: 0.95 },
          },
        }}
      >
        keep hovering for values…
      </Text>
    )}
  </VStack>
);

const ActiveTooltip: React.FC<{ label: string; lines: TooltipLine[] }> = ({
  label,
  lines,
}) => (
  <VStack gap={0.5} align="start">
    <Text textStyle="xs" fontWeight="semibold">
      {label}
    </Text>
    {lines.map((line, i) => (
      <Text
        key={`${i}-${line.text}`}
        textStyle="2xs"
        color={line.negated ? "red.fg" : undefined}
      >
        {line.text}
      </Text>
    ))}
  </VStack>
);

const CountBadge: React.FC<{ count: number }> = ({ count }) => (
  <Box
    position="absolute"
    top="-2px"
    right="-2px"
    minWidth="14px"
    height="14px"
    paddingX="3px"
    borderRadius="full"
    bg="blue.solid"
    color="white"
    textStyle="2xs"
    fontWeight="600"
    lineHeight="14px"
    textAlign="center"
  >
    {count}
  </Box>
);

const ActiveDot: React.FC = () => (
  <Box
    position="absolute"
    top="0"
    right="0"
    width="6px"
    height="6px"
    borderRadius="full"
    bg="blue.solid"
  />
);

function ariaLabelFor({
  label,
  isActive,
  badgeCount,
}: {
  label: string;
  isActive: boolean;
  badgeCount?: number;
}): string {
  if (!isActive) return label;
  if (badgeCount === undefined) return `${label} — active`;
  return `${label} — ${badgeCount} active filter${badgeCount === 1 ? "" : "s"}`;
}

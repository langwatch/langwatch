import { Box, VStack } from "@chakra-ui/react";
import type { ReactElement } from "react";
import { LuPin } from "react-icons/lu";
import type { PinnedAttribute } from "../../../stores/pinnedAttributesStore";
import { Chip } from "../Chip";
import { PinnedMetricPill } from "./MetricPill";

export type PinCategory = "identity" | "run" | "tag" | "custom";

export interface CategorizedPin {
  pin: PinnedAttribute;
  /** Resolved attribute / resource value at render time. */
  value: string | null;
  /** Auto-hoisted (purple sparkle) vs user-pinned (blue pin). */
  auto: boolean;
  /** Category bucket — controls grouping & order in the strip. */
  category: PinCategory;
  /**
   * If set, the pill grows a filter button that scopes the trace table to
   * this attribute's value (e.g. "find traces from this user").
   */
  onFilter?: () => void;
  /**
   * If set, the pill grows a "jump" arrow that navigates to the related
   * thing (conversation view, scenario run drawer, prompts tab, …).
   */
  onNavigate?: () => void;
  /** Tooltip / aria-label for the navigate icon, e.g. "Open conversation". */
  navigateLabel?: string;
}

/**
 * Order in which categories render. Identity (who/where) first, then runs
 * (which test/eval), then tags, then user-curated custom pins.
 */
const CATEGORY_ORDER: PinCategory[] = ["identity", "run", "tag", "custom"];

export interface PinRenderResult {
  /**
   * Pin pills + intra-category dividers, ready to spread into a flex
   * container. Empty when there are no pins.
   */
  inline: ReactElement[];
  /**
   * "+N more pinned" overflow chip (with popover listing the hidden pins),
   * or `null` when nothing overflows. Render after `inline`.
   */
  overflow: ReactElement | null;
}

interface RenderOptions {
  /**
   * Maximum number of *custom* (user-pinned) pills shown inline. The rest
   * collapse into the overflow popover so a user with 20 pinned attributes
   * doesn't blow out the strip. Auto-hoisted pins (identity/run/tag) are
   * always inline — they're a bounded set we know is glanceable.
   */
  maxCustomInline?: number;
}

/**
 * Render the pin pills as `(inline, overflow)` — auto-pins always render
 * inline with intra-category dividers. Custom pins are inlined up to
 * `maxCustomInline`; the remainder roll into an overflow popover chip so
 * the strip can't run away from a power user.
 */
export function renderPinPills(
  pins: CategorizedPin[],
  onUnpin: (source: PinnedAttribute["source"], key: string) => void,
  { maxCustomInline = 3 }: RenderOptions = {},
): PinRenderResult {
  if (pins.length === 0) return { inline: [], overflow: null };

  const buckets = bucketByCategory(pins);
  const inline: ReactElement[] = [];

  // Auto categories: always inline, divider between groups.
  let firstSection = true;
  for (const category of CATEGORY_ORDER) {
    if (category === "custom") continue;
    const groupPins = buckets[category] ?? [];
    if (groupPins.length === 0) continue;
    if (!firstSection) {
      inline.push(<PinDivider key={`divider-${category}`} />);
    }
    firstSection = false;
    for (const p of groupPins) {
      inline.push(renderPinPill(p, onUnpin));
    }
  }

  // Custom pins: render up to maxCustomInline; spill the rest into overflow.
  const customPins = buckets.custom ?? [];
  const inlineCustom = customPins.slice(0, maxCustomInline);
  const overflowCustom = customPins.slice(maxCustomInline);

  if (inlineCustom.length > 0) {
    if (!firstSection) {
      inline.push(<PinDivider key="divider-custom" />);
    }
    for (const p of inlineCustom) {
      inline.push(renderPinPill(p, onUnpin));
    }
  }

  let overflow: ReactElement | null = null;
  if (overflowCustom.length > 0) {
    overflow = (
      <Chip
        key="pin-overflow"
        icon={LuPin}
        label="Pinned"
        value={`+${overflowCustom.length}`}
        tone="blue"
        ariaLabel={`${overflowCustom.length} more pinned attributes`}
        popover={
          <VStack
            align="stretch"
            gap={1.5}
            padding={3}
            maxHeight="320px"
            overflowY="auto"
          >
            {overflowCustom.map((p) => (
              <Box key={`${p.pin.source}:${p.pin.key}`}>
                {renderPinPill(p, onUnpin)}
              </Box>
            ))}
          </VStack>
        }
      />
    );
  }

  return { inline, overflow };
}

function renderPinPill(
  p: CategorizedPin,
  onUnpin: (source: PinnedAttribute["source"], key: string) => void,
): ReactElement {
  return (
    <PinnedMetricPill
      key={`${p.pin.source}:${p.pin.key}`}
      pin={p.pin}
      value={p.value}
      auto={p.auto}
      onUnpin={onUnpin}
      onFilter={p.onFilter}
      onNavigate={p.onNavigate}
      navigateLabel={p.navigateLabel}
    />
  );
}

export function PinDivider() {
  return (
    <Box
      width="1px"
      height="14px"
      bg="border.muted"
      marginX={0.5}
      flexShrink={0}
      aria-hidden="true"
    />
  );
}

function bucketByCategory(
  pins: CategorizedPin[],
): Partial<Record<PinCategory, CategorizedPin[]>> {
  const out: Partial<Record<PinCategory, CategorizedPin[]>> = {};
  for (const p of pins) {
    const list = out[p.category] ?? [];
    list.push(p);
    out[p.category] = list;
  }
  return out;
}

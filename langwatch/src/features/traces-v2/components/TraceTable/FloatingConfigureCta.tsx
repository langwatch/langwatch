import { Box, Button, Icon } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { LuSettings2 } from "react-icons/lu";
import type React from "react";
import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useTraceTableScrollElement } from "./scrollContext";

/**
 * Scroll distance (px) past which the floating "Configure" CTA gets
 * the user's first-look activation. Picked to match roughly one
 * viewport scroll on a 1080p laptop — the operator has *engaged* with
 * the list (not just glanced at the top), which is the moment a "yes,
 * you can change what's shown here" nudge actually lands.
 */
const ACTIVATION_SCROLL_PX = 240;

/**
 * One-time activation animation — a single pulse + glow that fires the
 * first time the operator scrolls into the activation zone. After it
 * runs once, the user's `markConfigureCtaSeen` flag goes true (in
 * `uiStore`, persisted to localStorage) and the animation never plays
 * again on this browser. Without the persistence the CTA would feel
 * like an attention-grabber forever; with it, the nudge fires exactly
 * once per device per user, which is the whole point of a discovery
 * hint.
 */
const activationPulse = keyframes`
  0% {
    transform: scale(1);
    box-shadow:
      0 0 0 0 rgba(66, 153, 225, 0),
      0 1px 4px rgba(0, 0, 0, 0.18);
  }
  20% {
    transform: scale(1.06);
    box-shadow:
      0 0 0 6px rgba(66, 153, 225, 0.35),
      0 6px 18px rgba(66, 153, 225, 0.35);
  }
  50% {
    transform: scale(1.02);
    box-shadow:
      0 0 0 14px rgba(66, 153, 225, 0),
      0 4px 12px rgba(66, 153, 225, 0.18);
  }
  100% {
    transform: scale(1);
    box-shadow:
      0 0 0 0 rgba(66, 153, 225, 0),
      0 1px 4px rgba(0, 0, 0, 0.18);
  }
`;

/**
 * Floating "Configure" CTA pinned at the bottom-right of the trace
 * list. The sidebar's existing icon button (sliders + window panel)
 * was the only entry point to the facet-manager popover; audit
 * feedback was that icon-only affordances at the top of the sidebar
 * weren't discoverable enough — operators scrolled the list looking
 * for a way to add a column / facet and never noticed the icons up
 * top.
 *
 * Both buttons drive the *same* `facetManagerOpen` state in
 * `uiStore`, so opening from the CTA opens the same popover anchored
 * to the sidebar trigger. No duplicate state, no second popover
 * instance.
 *
 * Visual treatment:
 *   - Subtle fade-gradient backdrop behind the button so it reads as
 *     a "floating" surface on top of the scroll content, not as a
 *     stuck-on overlay competing with the rows.
 *   - One-time activation pulse on first meaningful scroll. Persisted
 *     to localStorage via `hasSeenConfigureCta` so the second visit
 *     never sees the pulse again.
 */
export const FloatingConfigureCta: React.FC = () => {
  const scrollEl = useTraceTableScrollElement();
  const setFacetManagerOpen = useUIStore((s) => s.setFacetManagerOpen);
  const hasSeenCta = useUIStore((s) => s.hasSeenConfigureCta);
  const markSeen = useUIStore((s) => s.markConfigureCtaSeen);

  // Local "activate now" trigger — flips true the moment the user has
  // scrolled past the threshold for the first time on this mount, and
  // stays true so the keyframe animation plays its full cycle even if
  // the user scrolls back up mid-pulse.
  const [activate, setActivate] = useState(false);

  useEffect(() => {
    if (hasSeenCta) return;
    if (!scrollEl) return;
    const onScroll = () => {
      if (scrollEl.scrollTop >= ACTIVATION_SCROLL_PX) {
        setActivate(true);
        markSeen();
      }
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    // Guard against the rare case where the page is auto-scrolled past
    // the threshold (deep-link, restored position) — fire the activation
    // synchronously on mount too.
    onScroll();
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl, hasSeenCta, markSeen]);

  return (
    // Backdrop wrapper paints the fade gradient + scopes pointer-events
    // so the operator can still click rows behind the affordance — the
    // gradient surface itself shouldn't intercept clicks, only the
    // button does.
    <Box
      position="absolute"
      right={3}
      bottom={3}
      // The pagination strip sits below; lift this just enough to clear
      // it without crashing into its border.
      paddingTop={6}
      pointerEvents="none"
      zIndex={3}
      background="linear-gradient(to top, var(--chakra-colors-bg-panel) 60%, transparent)"
      borderTopLeftRadius="lg"
      paddingX={3}
      paddingBottom={1}
    >
      <Button
        size="sm"
        variant="solid"
        colorPalette="blue"
        onClick={() => {
          markSeen();
          setFacetManagerOpen(true);
        }}
        // Pointer-events restored at the actual button so the rest of
        // the gradient surface stays click-through.
        pointerEvents="auto"
        animation={
          activate && !hasSeenCta
            ? `${activationPulse} 1.8s ease-out 1`
            : undefined
        }
        aria-label="Configure which facets appear in the sidebar"
      >
        <Icon as={LuSettings2} boxSize={4} />
        Configure
      </Button>
    </Box>
  );
};

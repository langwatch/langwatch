import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyPeekProximity } from "../hooks/useLangyPeekProximity";
import {
  FLOATING_PANEL_CSS_WIDTH,
  FLOATING_PANEL_INSET,
  LANGY_TRANSITION,
} from "../logic/langyPanelLayout";
import {
  FLOATING_PEEK_CARD_HEIGHT,
  type LangyPeekPhase,
  resolvePeekHiddenTransform,
  resolvePeekTransform,
  SIDEBAR_PEEK_CARD_WIDTH,
  SIDEBAR_PEEK_HEIGHT,
} from "../logic/langyPeekDock";
import { useLangyStore } from "../stores/langyStore";
import { LangyMark } from "./LangyMark";

/**
 * The minimised state — a PEEK of the panel itself, not a separate launcher.
 *
 * Floating mode: the card sinks below the bottom viewport edge, bottom-right
 * where it lives, leaving a sliver of its header lip. Sidebar mode: the
 * dock's spine peeks in from the right edge as a thin vertical sliver,
 * mid-height. Both rise a little as the pointer approaches (or on keyboard
 * focus), and open fully on click / Enter / Space — or the global Cmd/Ctrl+I,
 * which never depended on this surface at all.
 *
 * The peek wears the panel's own material (surface, hairline, brand seam)
 * and moves on the panel's own curve (LANGY_TRANSITION), so minimise reads
 * as the card sinking out of the way rather than being swapped for a button.
 * While a turn is still running underneath, the seam breathes on the fold's
 * own pulse period — the creature is minimised, not gone.
 *
 * Reduced motion: no proximity tracking runs; the peek's own hover/focus
 * swaps it to the raised state without animation, and its entrance is a
 * fade instead of a slide.
 *
 * Spec: specs/langy/langy-peek-dock.feature
 */
export function LangyPeekDock({
  isOpen,
  onOpen,
}: {
  isOpen: boolean;
  onOpen: () => void;
}) {
  // Render nothing while open — and REMOUNT on minimise, which is what arms
  // the entrance slide from fully-sunk to the resting sliver.
  if (isOpen) return null;
  return (
    // The peek mounts at the app-layout level (LangySidecar), a sibling of
    // the whole routed page — so a render crash in here must stay in here.
    // The boundary swaps a broken peek for the repo's inline error card
    // instead of blanking the page, and Cmd/Ctrl+I still opens the panel
    // (the shortcut lives above this subtree).
    <IsolatedErrorBoundary scope="Langy couldn't show its minimised panel">
      <LangyPeek onOpen={onOpen} />
    </IsolatedErrorBoundary>
  );
}

/**
 * Hold the entrance until the panel's close animation (160ms) has mostly
 * cleared, so the sinking card and the rising sliver read as one hand-off
 * rather than two things moving at once.
 */
const PEEK_ENTRANCE_DELAY_MS = 140;

function LangyPeek({ onOpen }: { onOpen: () => void }) {
  const panelMode = useLangyStore((s) => s.panelMode);
  // The turn phase, not isBusy: the durable machine keeps this true across a
  // silent worker and another tab's turn — exactly the work someone minimised
  // the panel to wait out.
  const turnActive = useLangyStore((s) => s.turnPhase !== "idle");
  const reduceMotion = useReducedMotion();
  // A right-anchored drawer owns the bottom-right corner while it is open, so
  // the floating peek rests along the bottom-LEFT edge instead (the same
  // dodge the floating panel itself makes). The sidebar sliver HOLDS its
  // right edge — it rides above the drawer's card (z, mirroring the drawer
  // companion) and is thin enough at rest to sit on the drawer's rim.
  const { currentDrawer } = useDrawer();
  const hasDrawer = !!currentDrawer;
  const floating = panelMode === "floating";
  const dodgeLeft = hasDrawer && floating;

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const near = useLangyPeekProximity({
    enabled: !reduceMotion,
    mode: panelMode,
    dodgeLeft,
  });
  const phase: LangyPeekPhase = near || hovered || focused ? "near" : "rest";

  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setEntered(true),
      PEEK_ENTRANCE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  // Slide on transform (compositor-friendly, the panel's own curve); under
  // reduced motion the transform pins to the phase and only opacity fades.
  const transform =
    reduceMotion || entered
      ? resolvePeekTransform({ mode: panelMode, phase })
      : resolvePeekHiddenTransform(panelMode);
  const opacity = reduceMotion && !entered ? 0 : 1;
  const transition = reduceMotion
    ? "opacity 160ms linear"
    : `transform ${LANGY_TRANSITION}`;

  return (
    <Tooltip
      content={
        <HStack gap={2}>
          <Text>Chat with Langy</Text>
          <HStack gap={1}>
            <Kbd>⌘</Kbd>
            <Kbd>I</Kbd>
          </HStack>
        </HStack>
      }
      positioning={{ placement: floating ? "top" : "left" }}
      openDelay={200}
    >
      <chakra.button
        type="button"
        className={`langy-root langy-peek${turnActive ? " langy-peek-working" : ""}`}
        data-peek-mode={panelMode}
        data-peek-phase={phase}
        {...(dodgeLeft ? { "data-peek-dodge": "left" } : {})}
        onClick={onOpen}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Open Langy assistant"
        aria-keyshortcuts="Meta+I Control+I"
        position="fixed"
        cursor="pointer"
        overflow="hidden"
        borderStyle="solid"
        borderColor="border"
        style={{ transform, opacity, transition }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "orange.emphasized",
          outlineOffset: "2px",
        }}
        {...(floating
          ? {
              // The card's own footprint, sunk: same width, same horizontal
              // inset, same glass, same hairline — laid out flush with the
              // bottom edge and translated below it.
              bottom: 0,
              ...(dodgeLeft
                ? { left: `${FLOATING_PANEL_INSET}px` }
                : { right: `${FLOATING_PANEL_INSET}px` }),
              width: FLOATING_PANEL_CSS_WIDTH,
              height: `${FLOATING_PEEK_CARD_HEIGHT}px`,
              zIndex: 1200,
              borderWidth: "1px",
              borderRadius: "20px",
              background: "bg.surface/85",
              backdropFilter: "blur(8px)",
              boxShadow:
                "0 -1px 2px rgba(20,20,23,0.04), 0 -8px 24px rgba(20,20,23,0.10)",
              _dark: {
                background: "bg.surface/88",
                boxShadow:
                  "0 -1px 2px rgba(0,0,0,0.4), 0 -10px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
              },
            }
          : {
              // The dock's spine: a rounded-left sliver holding the right
              // edge, opaque like the dock it stands for. Above the drawer
              // card while one is open (the drawer companion's own z).
              top: "50%",
              right: 0,
              width: `${SIDEBAR_PEEK_CARD_WIDTH}px`,
              height: `${SIDEBAR_PEEK_HEIGHT}px`,
              zIndex: hasDrawer ? 1600 : 1200,
              borderWidth: "1px",
              borderRightWidth: 0,
              borderTopLeftRadius: "12px",
              borderBottomLeftRadius: "12px",
              background: "bg.surface",
              boxShadow:
                "-1px 0 2px rgba(20,20,23,0.04), -8px 0 24px rgba(20,20,23,0.10)",
              _dark: {
                boxShadow:
                  "-1px 0 2px rgba(0,0,0,0.4), -10px 0 28px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.12)",
              },
            })}
      >
        {floating ? (
          // The header lip — laid out at the card's top so the risen peek
          // shows exactly the line the open panel's header shows.
          <HStack gap={2} paddingX="14px" height="36px" alignItems="center">
            <LangyMark size={15} />
            <Text
              textStyle="sm"
              fontWeight="600"
              letterSpacing="-0.01em"
              color="fg"
            >
              Langy
            </Text>
            <Box flex={1} />
            <HStack gap={1} opacity={phase === "near" ? 0.9 : 0}>
              <Kbd>⌘</Kbd>
              <Kbd>I</Kbd>
            </HStack>
          </HStack>
        ) : (
          // The mark sits by the sliver's left rim: clipped at rest, fully
          // revealed at the proximity width.
          <Box
            display="flex"
            alignItems="center"
            justifyContent="flex-start"
            paddingLeft="3px"
            height="full"
          >
            <LangyMark size={14} />
          </Box>
        )}
      </chakra.button>
    </Tooltip>
  );
}

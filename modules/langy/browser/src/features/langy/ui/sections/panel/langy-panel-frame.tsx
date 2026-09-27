import { Box, chakra } from "@chakra-ui/react";
import { motion } from "motion/react";
import { type ComponentProps, type ReactNode, type RefObject } from "react";

import type { useLangyContextDropZone } from "../../../../../behavior/use-langy-context-drop-zone.ts";
import { PANEL_ROOT_ATTR } from "../../../../../model/composer-morph-geometry.ts";
import {
  FLOATING_PEEK_NEAR_PX,
  SIDEBAR_PEEK_NEAR_PX,
} from "../../../../../model/langy-peek-dock.ts";
import { LangyWave } from "../../../../../ui/elements/langy-wave.tsx";
import type {
  useLangyPanelPeek,
  useLangyPanelPlacement,
} from "../../../behavior/panel/use-langy-panel-layout.ts";
import type { useLangyExternalLinkGuard } from "../use-langy-external-link-guard.ts";
import {
  panelMotionState,
  panelPlacementChrome,
  panelSizeCss,
  panelTransition,
  panelVariants,
  panelWidth,
} from "./langy-panel-chrome.ts";

// The panel stays MOUNTED when closed (unmounting would tear down useChat's
// in-flight stream), so open/close is a variant swap, not a mount.
const MotionBox = motion.create(Box);

type Placement = ReturnType<typeof useLangyPanelPlacement>;
type Peek = ReturnType<typeof useLangyPanelPeek>;

/** The peek's identity for CSS (langy-theme.css): its phase, its edge, and whether it works. */
function peekDataAttributes({
  peek,
  mode,
  turnActive,
}: {
  peek: Peek;
  mode: string;
  turnActive: boolean;
}) {
  if (!peek.peeking) return {};
  return {
    "data-langy-peek": peek.phase,
    "data-langy-peek-mode": mode,
    ...(turnActive ? { "data-langy-peek-working": "" } : {}),
  };
}

/**
 * The panel itself: one fixed surface that morphs between dock, floating card and drawer
 * companion (`layout="position"`), slides to a peek, and owns its own scrolling. Dialogs, drawers
 * and command surfaces can always cover it.
 */
export function LangyPanelFrame({
  panelRef,
  isOpen,
  placement,
  peek,
  dockShellClaimed,
  floorPx,
  isContextDropOver,
  turnActive,
  dropProps,
  guardProps,
  children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  placement: Placement;
  peek: Peek;
  dockShellClaimed: boolean;
  floorPx: number;
  isContextDropOver: boolean;
  turnActive: boolean;
  /** The context drop zone, at the root. */
  dropProps: ReturnType<typeof useLangyContextDropZone>["dropProps"];
  /** The external-link guard, capturing at the root. */
  guardProps: ReturnType<typeof useLangyExternalLinkGuard>["guardProps"];
  children: ReactNode;
}) {
  const { floating, reduceMotion, isDrawerCompanion } = placement;
  const touchable = (isOpen || peek.peeking) && !peek.dismissed;
  return (
    <MotionBox
      ref={panelRef}
      {...dropProps}
      {...guardProps}
      className="langy-root"
      layout="position"
      position="fixed"
      width={panelWidth({ floating, isDrawerCompanion })}
      zIndex={isDrawerCompanion ? 1600 : 1200}
      background={isDrawerCompanion ? "bg.surface/80" : "bg.surface"}
      borderStyle="solid"
      borderColor={isContextDropOver ? "purple.emphasized" : "border"}
      overflow="hidden"
      overscrollBehavior="none"
      display="flex"
      flexDirection="column"
      // Own isolated group, so the Split effect's blend inverts only the panel.
      isolation="isolate"
      // Invisible must also mean untouchable; a peeking panel is the affordance,
      // so it stays exposed to assistive tech with its body made inert instead.
      pointerEvents={touchable ? "auto" : "none"}
      aria-hidden={!isOpen && !peek.peeking}
      as="aside"
      aria-label="Langy assistant"
      data-tour="langy-panel"
      {...peekDataAttributes({ peek, mode: placement.panelMode, turnActive })}
      // The home page's send measures this closed panel's composer through it.
      {...{ [PANEL_ROOT_ATTR]: "" }}
      transformOrigin={floating ? "bottom right" : "right center"}
      initial={false}
      animate={panelMotionState({ isOpen, peekDismissed: peek.dismissed, peeking: peek.peeking })}
      variants={panelVariants(floating)}
      style={{ translate: peek.translate }}
      transition={panelTransition({ reduceMotion, isOpen })}
      css={panelSizeCss({ floating, reduceMotion })}
      {...panelPlacementChrome({
        floating,
        isDrawerCompanion,
        dockShellClaimed,
        dodgesDrawer: placement.floatingDodgesDrawer,
        minHeightPx: floorPx,
      })}
    >
      {children}
    </MotionBox>
  );
}

/**
 * What sits under the content: the floating card's texture and brand glow (dark ground only, see
 * langy-theme.css), and the "fold" — a living seam moving with Langy's own activity, never the
 * cursor, only while open.
 */
export function LangyPanelBackdrop({
  floating,
  reduceMotion,
  panelRef,
  wave,
}: {
  floating: boolean;
  reduceMotion: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  wave: Pick<ComponentProps<typeof LangyWave>, "active" | "activity" | "statusActive">;
}) {
  return (
    <>
      {floating ? <Box className="langy-signal-grid" aria-hidden /> : null}
      {floating ? <Box className="langy-panel-glow" aria-hidden /> : null}
      <LangyWave
        containerRef={panelRef}
        {...wave}
        compact={!floating}
        reduceMotion={reduceMotion}
      />
    </>
  );
}

/**
 * THE PEEK'S ONLY CONTROL: a real button over the resting sliver's header, so Tab reaches it and
 * Enter/Space opens. It covers the whole RISEN sliver, a different shape in each mode.
 */
export function LangyPeekControl({
  floating,
  peek,
  onOpen,
}: {
  floating: boolean;
  peek: Peek;
  onOpen: () => void;
}) {
  const area = floating
    ? { top: 0, left: 0, right: 0, height: `${FLOATING_PEEK_NEAR_PX}px` }
    : { top: 0, bottom: 0, left: 0, width: `${SIDEBAR_PEEK_NEAR_PX}px` };
  return (
    <chakra.button
      type="button"
      onClick={onOpen}
      onPointerEnter={() => peek.setHovered(true)}
      onPointerLeave={() => peek.setHovered(false)}
      onFocus={() => peek.setFocused(true)}
      onBlur={() => peek.setFocused(false)}
      aria-label="Open Langy assistant"
      aria-keyshortcuts="Meta+I Control+I"
      position="absolute"
      {...area}
      zIndex={3}
      cursor="pointer"
      background="transparent"
      borderWidth={0}
      borderRadius="inherit"
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "orange.emphasized",
        outlineOffset: "-2px",
      }}
    />
  );
}

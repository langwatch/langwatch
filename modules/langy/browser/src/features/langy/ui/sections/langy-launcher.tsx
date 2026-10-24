import { useDrawer } from "@langwatch/browser-host/drawer";
import { Kbd } from "@langwatch/design-system/kbd";
import { LangyMark } from "@langwatch/design-system/langy-mark";
import { chakra, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";

// The orb's glow rule lives here; without it the glow span becomes a grid row
// and pushes the mark off-centre until the panel's chunk loads the sheet.
import "@langwatch/design-system/langy-theme.css";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useLangyOrbProximity } from "../../../../behavior/use-langy-orb-proximity.ts";
import { useLingeringDodge } from "../../../../behavior/use-lingering-dodge.ts";
import { LANGY_DODGE_STAGGER_MS } from "../../../../model/langy-panel-layout.ts";
import { langyLauncherRightOffset } from "../../behavior/logic/langy-launcher-position.ts";
import { readSidebarRight, useOpenDrawerEdge } from "../../behavior/panel/use-open-drawer-edge.ts";

/**
 * The FLAG-OFF closed-state opener — a single circular launcher in the bottom-right
 * corner (the Notion-AI model).
 */
export function LangyLauncher({ isOpen, onOpen }: { isOpen: boolean; onOpen: () => void }) {
  const reduceMotion = useReducedMotion();
  // A right-anchored drawer fills the right edge while the panel is closed, so
  // the bottom-right launcher would sit on top of it (and the table pager).
  // Dodge to the bottom-LEFT corner while a drawer is open; hop back only a
  // beat after the drawer has left, on the same cadence as the panel's dodge.
  const { currentDrawer } = useDrawer();
  const dodgeLeft = useLingeringDodge({
    active: !!currentDrawer,
    releaseDelayMs: LANGY_DODGE_STAGGER_MS,
    immediate: reduceMotion,
  });
  const measuredEdge = useOpenDrawerEdge({ active: dodgeLeft });
  const launcherRight = langyLauncherRightOffset({
    drawerEdge: dodgeLeft ? measuredEdge : null,
    sidebarRight: measuredEdge === null ? 0 : readSidebarRight(),
    viewportWidth: window.innerWidth,
  });
  // The orb leans + glows toward the cursor as it approaches (the one place a Langy
  // surface reacts to the pointer — a hover affordance on the target itself, not
  // ambient chrome). Disabled under reduced motion.
  const { orbRef, glowRef, activate } = useLangyOrbProximity({
    enabled: !reduceMotion && !isOpen,
  });
  // A surface held above the page's overlays (the Studio code editor) sits over this corner
  // and offers its own way into Langy, so the orb steps aside rather than hide under it.
  const heldAbove = useLangyStore((s) => s.aboveHolds > 0);
  if (isOpen || heldAbove) return null;
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
      positioning={{ placement: "left" }}
      openDelay={200}
    >
      <chakra.button
        ref={orbRef}
        type="button"
        className="langy-root"
        data-langy-orb=""
        onClick={() => {
          // Fire the bloom while the orb is still mounted (reads its rect), then
          // open — the bloom outlives the unmount on its own.
          activate();
          onOpen();
        }}
        aria-label="Open Langy assistant"
        aria-keyshortcuts="Meta+I Control+I"
        position="fixed"
        bottom="20px"
        // Bottom-right by default; while a drawer holds the right edge it sits just
        // left of the drawer, over the page, never on the drawer or the sidebar.
        right={`${launcherRight}px`}
        // Keep modal/dialog layers above Langy. Chakra's modal stack starts at
        // the modal layer, while Langy remains a persistent app companion.
        zIndex={1200}
        width="46px"
        height="46px"
        borderRadius="full"
        display="grid"
        placeItems="center"
        background="bg.card"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="border.emphasized"
        boxShadow="0 1px 2px color-mix(in srgb, var(--chakra-colors-bg-scrim) 8%, transparent), 0 8px 24px color-mix(in srgb, var(--chakra-colors-bg-scrim) 14%, transparent)"
        _dark={{
          boxShadow:
            "0 1px 2px color-mix(in srgb, var(--chakra-colors-bg-scrim) 50%, transparent), 0 10px 30px color-mix(in srgb, var(--chakra-colors-bg-scrim) 55%, transparent)",
        }}
        cursor="pointer"
        transition="box-shadow 160ms ease, border-color 160ms ease"
        _hover={{
          borderColor: "orange.emphasized",
          boxShadow:
            "0 2px 4px color-mix(in srgb, var(--chakra-colors-bg-scrim) 10%, transparent), 0 12px 32px color-mix(in srgb, var(--chakra-colors-bg-scrim) 18%, transparent)",
        }}
      >
        {/* Warm proximity glow — bleeds out around the orb toward the cursor.
            Behind the orb body (z-index -1) so only the reaching edge shows;
            positioned + faded imperatively by useLangyOrbProximity. */}
        <span ref={glowRef} className="langy-orb-glow" aria-hidden />
        <LangyMark size={26} />
      </chakra.button>
    </Tooltip>
  );
}

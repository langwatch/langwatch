import { Box } from "@chakra-ui/react";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { PANEL_LAYOUT_TRANSITION } from "../logic/langyPanelLayout";
import type { ComposerFlight } from "../hooks/useComposerMorph";

const MotionBox = motion.create(Box);

/** Held constant across the whole trip: it is what sells one object moving. */
const COMPOSER_RADIUS = "18px";

/** When the carried copy of the question lets go of the bar. */
const TEXT_RELEASE_MS = 170;

/**
 * The composer, in the air.
 *
 * A copy, not the composer: `aria-hidden` and `pointer-events: none`, carrying
 * a static picture of the question rather than a live field. Screen readers and
 * the keyboard never meet it, so the real composers on either end keep their
 * caret, their selection and any in-flight IME composition. Portalled to the
 * body because it has to fly over a `position: fixed` panel that lives in an
 * entirely different tree.
 *
 * Spec: specs/home/langy-home-morph.feature
 */
export function ComposerMorphGhost({ flight }: { flight: ComposerFlight }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* The warm mass, borrowed from the block and dying on the way out. The
          shader itself never moves: what travels is this cheap radial copy of
          it, and it is gone by the time the panel's own glow takes over. */}
      <MotionBox
        aria-hidden
        position="fixed"
        pointerEvents="none"
        zIndex={1399}
        borderRadius="full"
        filter="blur(28px)"
        background="radial-gradient(circle, var(--chakra-colors-orange-solid) 0%, transparent 68%)"
        initial={{
          top: flight.glow.top,
          left: flight.glow.left,
          width: flight.glow.width,
          height: flight.glow.height,
          opacity: 0.32,
        }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      />
      <MotionBox
        aria-hidden
        position="fixed"
        pointerEvents="none"
        zIndex={1400}
        display="flex"
        alignItems="center"
        overflow="hidden"
        paddingX={3}
        borderRadius={COMPOSER_RADIUS}
        borderWidth="1px"
        borderStyle="solid"
        borderColor="orange.emphasized"
        background="bg.panel"
        boxShadow="0 0 0 4px var(--chakra-colors-orange-subtle), 0 8px 28px -8px rgba(0,0,0,0.24)"
        initial={{
          top: flight.origin.top,
          left: flight.origin.left,
          width: flight.origin.width,
          height: flight.origin.height,
        }}
        animate={{
          top: flight.destination.top,
          left: flight.destination.left,
          width: flight.destination.width,
          height: flight.destination.height,
        }}
        // The panel's own placement spring, verbatim. The two morphs are the
        // same gesture at different scales, so they must not be two springs.
        transition={PANEL_LAYOUT_TRANSITION}
      >
        <MotionBox
          textStyle="sm"
          color="fg"
          lineHeight="1.5"
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
          width="full"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          // Lets go partway across, as the panel's own copy of the question
          // rises into the thread to meet it. Two pictures of one sentence
          // never overlap for longer than a blink.
          transition={{
            duration: 0.14,
            delay: TEXT_RELEASE_MS / 1000,
            ease: "easeOut",
          }}
        >
          {flight.text}
        </MotionBox>
      </MotionBox>
    </>,
    document.body,
  );
}

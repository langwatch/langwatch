import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { AuroraSvg } from "../../components/TracesPage/AuroraSvg";
import { shouldShowAurora } from "../chapters/onboardingJourneyConfig";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * Aurora ribbon that flares across the top of the trace table during
 * the `auroraArrival` stage — the marquee visual moment of the
 * journey, mirroring `RefreshProgressBar`'s aurora pattern so the
 * "new traces are arriving" idea reads consistently across the
 * platform.
 *
 * Self-gating: returns `null` outside aurora stages so the parent
 * doesn't have to know about `shouldShowAurora`. The component
 * absolute-positions itself within whatever ancestor establishes a
 * positioning context — currently the table-area `Box` inside
 * `EmptyResultsPane`, which the host structure preserves.
 *
 * Position math (top: -90px, height: 200px) was tuned so the ribbon
 * peaks above the table's first row and fades into transparent over
 * the first ~65% of its height; the horizontal mask fades the
 * ribbon into the page edges so it doesn't read as a banner when
 * the sidebar is hidden.
 */
export const OnboardingAurora: React.FC = () => {
  const stage = useOnboardingStore((s) => s.stage);
  const showAurora = shouldShowAurora(stage);

  return (
    <AnimatePresence>
      {showAurora && (
        <motion.div
          key="onboarding-aurora"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{
            position: "absolute",
            top: "-90px",
            left: 0,
            right: 0,
            height: 200,
            pointerEvents: "none",
            zIndex: 2,
            overflow: "hidden",
            maskImage:
              "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%), linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 14%, rgba(0,0,0,1) 86%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%), linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 14%, rgba(0,0,0,1) 86%, transparent 100%)",
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        >
          <AuroraSvg idSuffix="onboardingArrival" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

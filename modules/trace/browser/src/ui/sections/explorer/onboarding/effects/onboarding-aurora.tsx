import { AnimatePresence, motion } from "motion/react";
import type React from "react";

import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store.ts";
import { shouldShowAurora } from "../../../../../model/explorer/onboarding/chapters/onboarding-journey-config.ts";
import { AuroraSvg } from "../../../../elements/explorer/traces-page/aurora-svg.tsx";

// Aurora ribbon at trace table top (auroraArrival stage); mirrors
// RefreshProgressBar's aurora pattern for consistent "arriving" visual.
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
              "linear-gradient(to bottom, var(--chakra-colors-fg) 0%, var(--chakra-colors-fg) 35%, color-mix(in srgb, var(--chakra-colors-fg) 70%, transparent) 65%, transparent 100%), linear-gradient(to right, transparent 0%, var(--chakra-colors-fg) 14%, var(--chakra-colors-fg) 86%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, var(--chakra-colors-fg) 0%, var(--chakra-colors-fg) 35%, color-mix(in srgb, var(--chakra-colors-fg) 70%, transparent) 65%, transparent 100%), linear-gradient(to right, transparent 0%, var(--chakra-colors-fg) 14%, var(--chakra-colors-fg) 86%, transparent 100%)",
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

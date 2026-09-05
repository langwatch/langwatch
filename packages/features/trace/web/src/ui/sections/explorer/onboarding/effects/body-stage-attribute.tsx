import { useEffect } from "react";
import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store";

/**
 * Tags `<body>` with the current onboarding stage so global CSS rules can react —
 * specifically the drawer and sidebar glow that highlight those targets while the
 * corresponding stage is active.
 */
export function BodyStageAttribute(): null {
  const stage = useOnboardingStore((s) => s.stage);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.tracesTourStage = stage;
    return () => {
      delete document.body.dataset.tracesTourStage;
    };
  }, [stage]);

  return null;
}

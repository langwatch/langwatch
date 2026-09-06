import { useEffect } from "react";
import { useOnboardingStore } from "../store/onboardingStore";

/**
 * Tags `<body>` with the current onboarding stage so global CSS rules
 * can react — specifically the drawer and sidebar glow that highlight
 * those targets while the corresponding stage is active. The drawer
 * is portaled to body, so a parent-scoped CSS selector can't reach it;
 * a body-level `data-traces-tour-stage` attribute is the simplest hook
 * a global stylesheet can match against.
 *
 * Renders nothing. Mounts only when `OnboardingHost` decides onboarding
 * is active, so users not in the journey never get the attribute on
 * their body element.
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

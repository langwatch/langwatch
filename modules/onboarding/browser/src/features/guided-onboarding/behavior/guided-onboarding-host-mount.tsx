/**
 * Nested inside `OnboardingHostApi`'s mount (declaration order in
 * onboarding.web.ts) so `useOnboardingHost()` resolves. ARCHITECTURE.md §10.1.
 */

import type { ReactNode } from "react";

import { GuidedOnboardingHost } from "./guided-onboarding-host.tsx";

export default function GuidedOnboardingHostMount({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <GuidedOnboardingHost />
    </>
  );
}

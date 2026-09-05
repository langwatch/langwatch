/**
 * The application's attribution provider slot.
 */

import { useAttributionCapture } from "@langwatch/onboarding-web/hooks/useAttributionCapture";
import type { ReactNode } from "react";

export function OnboardingAttributionProvider({ children }: { children: ReactNode }) {
  useAttributionCapture();
  return <>{children}</>;
}

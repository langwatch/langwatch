/**
 * The application's attribution provider slot.
 *
 * It sits outermost, above the session and the router, because first-touch
 * attribution has to be recorded on the landing URL — including the
 * unauthenticated ones — before a navigation drops the query string. The rule
 * and the storage are `@langwatch/onboarding-web`'s; this is the mount point.
 */

import { useAttributionCapture } from "@langwatch/onboarding-web/hooks/useAttributionCapture";
import type { ReactNode } from "react";

export function OnboardingAttributionProvider({ children }: { children: ReactNode }) {
  useAttributionCapture();
  return <>{children}</>;
}

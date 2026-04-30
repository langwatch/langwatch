import type React from "react";
import { useOnboardingActive } from "./hooks/useOnboardingActive";
import { BodyStageAttribute } from "./effects/BodyStageAttribute";
import { DrawerGlow } from "./effects/DrawerGlow";

interface OnboardingHostProps {
  children: React.ReactNode;
}

/**
 * Single mount point for onboarding side-effects (the body data
 * attribute that drives stage-specific CSS, the drawer/sidebar glow
 * `<style>` tag). Lazy-mounts everything: when `useOnboardingActive()`
 * is false, the host returns `{children}` verbatim — no DOM nodes,
 * no body attributes, no global stylesheet additions.
 *
 * The empty-state hero overlay, sample-data banner, and aurora ribbon
 * still live where they are at the moment (rendered conditionally
 * inside `TracesPage`'s `EmptyResultsPane`). Folding those into the
 * host is a future iteration; this host establishes the boundary
 * and the lazy-mount discipline so we have somewhere to grow.
 */
export function OnboardingHost({
  children,
}: OnboardingHostProps): React.ReactElement {
  const active = useOnboardingActive();

  if (!active) return <>{children}</>;

  return (
    <>
      <BodyStageAttribute />
      <DrawerGlow />
      {children}
    </>
  );
}

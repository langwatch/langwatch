import type React from "react";
import { BodyStageAttribute } from "./effects/body-stage-attribute";
import { CloseDrawerOnTour } from "./effects/close-drawer-on-tour";
import { DrawerGlow } from "../../../elements/explorer/onboarding/effects/drawer-glow";
import { RichRowGlow } from "./effects/rich-row-glow";
import { useOnboardingActive } from "../../../../behavior/explorer/onboarding/use-onboarding-active";

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
export function OnboardingHost({ children }: OnboardingHostProps): React.ReactElement {
  const active = useOnboardingActive();

  if (!active) return <>{children}</>;

  return (
    <>
      <BodyStageAttribute />
      <CloseDrawerOnTour />
      <DrawerGlow />
      <RichRowGlow />
      {children}
    </>
  );
}

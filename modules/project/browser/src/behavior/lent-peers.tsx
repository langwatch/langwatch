/** What analytics, navigation, organization and trace lend this module (§3.4 rule 7). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiAgentActionsMenuProps,
  UiCustomGraphProps,
  UiInlineCommandPaletteProps,
  UiPendingJoinRequestsProps,
  UiProjectDepartmentFieldProps,
} from "@langwatch/browser-host/declarations";
import { Lent } from "@langwatch/browser-host/lent";
import {
  GuidedOnboardingOfferToken,
  type GuidedOnboardingOfferProps,
} from "@langwatch/onboarding-contract";
import { lazy, Suspense, useMemo } from "react";

/** Navigation's command palette, drawn inline as navigation lends it. */
export function InlineCommandPalette(props: UiInlineCommandPaletteProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("inlineCommandPalette")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Onboarding's "Start guided onboarding" pill, drawn as onboarding lends it. */
export function GuidedOnboardingOffer(props: GuidedOnboardingOfferProps) {
  return <Lent of={GuidedOnboardingOfferToken} props={props} />;
}

/** Organization's department row for a project, as organization lends it. */
export function ProjectDepartmentField(props: UiProjectDepartmentFieldProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("projectDepartmentField")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Organization's card of people waiting to join, drawn as organization lends it. */
export function PendingJoinRequests(props: UiPendingJoinRequestsProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("pendingJoinRequests")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Analytics' custom graph, drawn as analytics lends it. */
export function CustomGraph(props: UiCustomGraphProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("customGraph")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

/** Trace's agent actions menu, drawn as trace lends it. */
export function AgentActionsMenu(props: UiAgentActionsMenuProps) {
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so it is not remounted.
  const lent = useMemo(
    () =>
      declarations
        .declared("agentActionsMenu")
        .map(({ module, capability }) => ({ key: module, Lent: lazy(capability.load) })),
    [declarations],
  );
  return lent.map(({ key, Lent }) => (
    <Suspense key={key} fallback={null}>
      <Lent {...props} />
    </Suspense>
  ));
}

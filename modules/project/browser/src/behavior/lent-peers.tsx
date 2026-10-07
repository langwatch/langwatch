/** What analytics, navigation, onboarding, organization and trace lend this module (§10.1). */

import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type {
  UiAgentActionsMenuProps,
  UiCustomGraphProps,
} from "@langwatch/browser-host/declarations";
import { Lent } from "@langwatch/browser-host/lent";
import {
  InlineCommandPaletteToken,
  type InlineCommandPaletteProps,
} from "@langwatch/navigation-client";
import { GuidedOnboardingOfferToken } from "@langwatch/onboarding-client";
import type { GuidedOnboardingOfferProps } from "@langwatch/onboarding-contract";
import {
  PendingJoinRequestsToken,
  ProjectDepartmentFieldToken,
  type PendingJoinRequestsProps,
  type ProjectDepartmentFieldProps,
} from "@langwatch/organization-client";
import { lazy, Suspense, useMemo } from "react";

/** Navigation's command palette, drawn inline as navigation lends it. */
export function InlineCommandPalette(props: InlineCommandPaletteProps) {
  return <Lent of={InlineCommandPaletteToken} props={props} />;
}

/** Onboarding's "Start guided onboarding" pill, drawn as onboarding lends it. */
export function GuidedOnboardingOffer(props: GuidedOnboardingOfferProps) {
  return <Lent of={GuidedOnboardingOfferToken} props={props} />;
}

/** Organization's department row for a project, as organization lends it. */
export function ProjectDepartmentField(props: ProjectDepartmentFieldProps) {
  return <Lent of={ProjectDepartmentFieldToken} props={props} />;
}

/** Organization's card of people waiting to join, drawn as organization lends it. */
export function PendingJoinRequests(props: PendingJoinRequestsProps) {
  return <Lent of={PendingJoinRequestsToken} props={props} />;
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

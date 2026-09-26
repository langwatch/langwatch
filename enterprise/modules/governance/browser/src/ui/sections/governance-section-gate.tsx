// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ComponentType } from "react";

import { useGovernanceHost } from "../../model/governance-host.ts";
import { NotFoundScene } from "../elements/not-found-scene.tsx";

export const GOVERNANCE_SECTION_FLAG = "release_ui_ai_governance_enabled";

/** Every governance page sits behind the section flag, as main's `withFeatureFlagGuard` did. */
export function withGovernanceSection<P extends object>(Page: ComponentType<P>): ComponentType<P> {
  const Gated = (props: P) => {
    const host = useGovernanceHost();
    if (!host.isFeatureEnabled(GOVERNANCE_SECTION_FLAG)) return <NotFoundScene />;
    return <Page {...props} />;
  };
  Gated.displayName = `withGovernanceSection(${Page.displayName ?? Page.name ?? "Page"})`;
  return Gated;
}

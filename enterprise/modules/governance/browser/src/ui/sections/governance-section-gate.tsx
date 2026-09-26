// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ComponentType } from "react";

import { useGovernanceHost } from "../../model/governance-host.ts";
import { NotFoundScene } from "../elements/not-found-scene.tsx";
import { PermissionRequiredNotice } from "../elements/permission-required-notice.tsx";
import GovernanceLayout from "./governance-layout.tsx";

export const GOVERNANCE_SECTION_FLAG = "release_ui_ai_governance_enabled";
export const GOVERNANCE_BILLED_COST_FLAG = "release_ui_governance_billed_cost_enabled";
const GOVERNANCE_VIEW = "governance:view";

type GovernanceSectionGate = {
  /** A release flag composed on top of the section flag, never instead of it. */
  releaseFlag?: string;
  /** The grant the page needs once it exists; `governance:view` unless named. */
  permission?: string;
};

/** Main's page guards, in main's order: section flag, release flag, then the grant. */
export function withGovernanceSection<P extends object>(
  Page: ComponentType<P>,
  { releaseFlag, permission = GOVERNANCE_VIEW }: GovernanceSectionGate = {},
): ComponentType<P> {
  const Gated = (props: P) => {
    const host = useGovernanceHost();
    if (!host.isFeatureEnabled(GOVERNANCE_SECTION_FLAG)) return <NotFoundScene />;
    if (releaseFlag !== void 0 && !host.isFeatureEnabled(releaseFlag)) return <NotFoundScene />;
    if (!host.hasPermission(permission)) {
      return (
        <GovernanceLayout>
          <PermissionRequiredNotice permission={permission} />
        </GovernanceLayout>
      );
    }
    return <Page {...props} />;
  };
  Gated.displayName = `withGovernanceSection(${Page.displayName ?? Page.name ?? "Page"})`;
  return Gated;
}

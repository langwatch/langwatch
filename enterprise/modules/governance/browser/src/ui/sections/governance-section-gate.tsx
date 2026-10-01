// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Skeleton, VStack } from "@langwatch/design-system/primitives";
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

/** The wait, drawn inside the chrome the shell already owns. */
function GovernanceLoading() {
  return (
    <GovernanceLayout>
      <PageLayout.Container>
        <VStack align="stretch" gap={4} data-testid="governance-loading">
          <Skeleton height="32px" width="240px" />
          <Skeleton height="160px" />
          <Skeleton height="240px" />
        </VStack>
      </PageLayout.Container>
    </GovernanceLayout>
  );
}

/** Main's page guards, in main's order: section flag, release flag, then the grant; loading until all answer. */
export function withGovernanceSection<P extends object>(
  Page: ComponentType<P>,
  { releaseFlag, permission = GOVERNANCE_VIEW }: GovernanceSectionGate = {},
): ComponentType<P> {
  const Gated = (props: P) => {
    const host = useGovernanceHost();
    const flags =
      releaseFlag === void 0 ? [GOVERNANCE_SECTION_FLAG] : [GOVERNANCE_SECTION_FLAG, releaseFlag];
    const answers = flags.map((flag) => host.featureFlag(flag));
    if (answers.some((answer) => answer === void 0)) return <GovernanceLoading />;
    if (answers.some((answer) => answer === false)) return <NotFoundScene />;
    if (!host.isSettled()) return <GovernanceLoading />;
    if (!host.hasPermission(permission)) {
      return (
        <GovernanceLayout>
          <PageLayout.Container>
            <PermissionRequiredNotice permission={permission} />
          </PageLayout.Container>
        </GovernanceLayout>
      );
    }
    return <Page {...props} />;
  };
  Gated.displayName = `withGovernanceSection(${Page.displayName ?? Page.name ?? "Page"})`;
  return Gated;
}

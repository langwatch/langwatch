// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import CostsPage from "../../../features/costs/ui/sections/costs-page.tsx";
import { useGovernanceHost } from "../../../model/governance-host.ts";
import { NotFoundScene } from "../../../ui/elements/not-found-scene.tsx";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";

const BILLED_COST_FLAG = "release_ui_governance_billed_cost_enabled";
const COSTS_PERMISSION = "governanceCost:view";

/** Costs sits behind the billed-cost flag and `governanceCost:view`, as main's guards did. */
function CostsScreen() {
  const host = useGovernanceHost();
  if (!host.isFeatureEnabled(BILLED_COST_FLAG)) return <NotFoundScene />;
  if (!host.hasPermission(COSTS_PERMISSION)) {
    return (
      <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
        <PermissionRequiredNotice permission={COSTS_PERMISSION} />
      </GovernanceLayout>
    );
  }
  return <CostsPage />;
}

export default CostsScreen;

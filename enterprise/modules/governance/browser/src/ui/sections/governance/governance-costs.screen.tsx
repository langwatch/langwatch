// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import CostsPage from "../../../features/costs/ui/sections/costs-page.tsx";
import {
  GOVERNANCE_BILLED_COST_FLAG,
  withGovernanceSection,
} from "../../../ui/sections/governance-section-gate.tsx";

/** Costs sits behind the billed-cost flag and `governanceCost:view`, as main's guards did. */
export default withGovernanceSection(CostsPage, {
  releaseFlag: GOVERNANCE_BILLED_COST_FLAG,
  permission: "governanceCost:view",
});

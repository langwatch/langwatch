// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { useRecordPageOpened } from "@langwatch/auth-client";

import CostsPage from "../../../features/costs/ui/sections/costs-page.tsx";
import {
  GOVERNANCE_BILLED_COST_FLAG,
  withGovernanceSection,
} from "../../../ui/sections/governance-section-gate.tsx";

/** Inside the gate: someone the section turns away did not open the page. */
function AnnouncedCostsPage() {
  useRecordPageOpened({ page: "governance_costs" });
  return <CostsPage />;
}

/** Costs sits behind the billed-cost flag and `governanceCost:view`, as main's guards did. */
export default withGovernanceSection(AnnouncedCostsPage, {
  releaseFlag: GOVERNANCE_BILLED_COST_FLAG,
  permission: "governanceCost:view",
});

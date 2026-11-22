import { NotFoundScene } from "../../../ui/elements/not-found-scene.tsx";
import {
  GOVERNANCE_BILLED_COST_FLAG,
  withGovernanceSection,
} from "../../../ui/sections/governance-section-gate.tsx";

/**
 * The unfinished Billed destination stays unavailable even when Costs is on, as on main.
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature (billed-cost section).
 */
function BilledPage() {
  return <NotFoundScene />;
}

export default withGovernanceSection(BilledPage, { releaseFlag: GOVERNANCE_BILLED_COST_FLAG });

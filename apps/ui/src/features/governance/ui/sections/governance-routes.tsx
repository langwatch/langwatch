/**
 * Which page key each governance screen answers, and what it is wrapped in.
 *
 * The route table names eleven page keys under `/governance`; the package
 * exposes eleven loaders under names of its own. This is the map between them,
 * and the only place either vocabulary meets the other.
 *
 * The guard states the policy the two platform higher-order components used to
 * carry — the section flag first, then the page's own flag where it has one,
 * then the grant — with the flag reading as a 404 for everyone before any
 * permission is considered.
 */

import type { ComponentType } from "react";
import {
  governanceScreens,
  type GovernanceScreenName,
} from "@langwatch/enterprise-governance-web/screens/governance";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { GovernanceHost } from "./governance-host";

/** Every governance page is behind this, and behind `governance:view`. */
const GOVERNANCE_SECTION_FLAG = "release_ui_ai_governance_enabled";

/** The cost pages are behind their own flag on top of the section's. */
const BILLED_COST_FLAG = "release_ui_governance_billed_cost_enabled";

const GOVERNANCE_PERMISSION = "governance:view";

function governancePage(screen: GovernanceScreenName, flags: readonly string[]): UiPageLoader {
  return uiPage({
    screen: async () => ({ default: (await governanceScreens[screen]()).default as ComponentType }),
    host: GovernanceHost,
    permission: GOVERNANCE_PERMISSION,
    flags,
  });
}

const SECTION = [GOVERNANCE_SECTION_FLAG] as const;
const BILLED = [GOVERNANCE_SECTION_FLAG, BILLED_COST_FLAG] as const;

export const governancePageLoaders: UiPageLoaderRegistry = {
  "pages/governance/index": governancePage("overview", SECTION),
  "pages/governance/inventory.enterprise": governancePage("inventory", SECTION),
  "pages/governance/ingestion-source-detail.enterprise": governancePage("ingestionSource", SECTION),
  "pages/governance/anomaly-rules.enterprise": governancePage("anomalyRules", SECTION),
  "pages/governance/people": governancePage("people", SECTION),
  "pages/governance/costs": governancePage("costs", BILLED),
  "pages/governance/billed": governancePage("billed", BILLED),
  "pages/governance/teams": governancePage("teams", SECTION),
  "pages/governance/teams/[id]": governancePage("team", SECTION),
  "pages/governance/users": governancePage("users", SECTION),
  "pages/governance/users/[id]": governancePage("user", SECTION),
};

/**
 * Catch-all route for the Agent Testing page.
 *
 * One page file serves every Agent Testing address so navigation inside the
 * page is shallow: no page transition, no remount, and no dropped live-run
 * subscription. The addresses it serves are listed in useAgentTestingRouting.
 *
 * The release flag sits OUTSIDE the permission guard, so the address reads as
 * "not found" for everyone while the flag is off, before any permission is
 * read. The flag alone grants nothing: a person without permission to read
 * test cases is still refused.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { AgentTestingPage } from "../../ui/sections/agent-testing/agent-testing-page";

function AgentTestingRoutePage() {
  return <AgentTestingPage />;
}


/**
 * The guard is the ROUTE's, and it did not travel.
 *
 * `withPermissionGuard("scenarios:view")` and, for Agent Testing,
 * `withFeatureFlagGuard("release_ui_agent_testing_v2_enabled")` state a policy
 * about an ADDRESS — flags before permissions, nothing refused while an answer
 * is still arriving — and the composing application states it in front of the
 * loader, where a refusal can render the application's own fallback. The
 * `layoutComponent: DashboardLayout` half is chrome, and chrome belongs to the
 * route tree.
 */
export default AgentTestingRoutePage;

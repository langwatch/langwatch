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

import { AgentTestingPage } from "~/components/agent-testing/AgentTestingPage";
import { DashboardLayout } from "~/components/DashboardLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

function AgentTestingRoutePage() {
  return <AgentTestingPage />;
}

export default withFeatureFlagGuard("release_ui_agent_testing_v2_enabled")(
  withPermissionGuard("scenarios:view", {
    layoutComponent: DashboardLayout,
  })(AgentTestingRoutePage),
);

/**
 * Catch-all route for the Agent Testing page.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { AgentTestingPage } from "../../ui/sections/agent-testing/agent-testing-page";

function AgentTestingRoutePage() {
  return <AgentTestingPage />;
}

/**
 * The guard is the ROUTE's, and it did not travel.
 */
export default AgentTestingRoutePage;

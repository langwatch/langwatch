/**
 * Catch-all route for the Agent Testing page, behind the release flag and then the grant.
 * @see specs/features/agent-testing/page-structure.feature
 */

import {
  AGENT_TESTING_PERMISSION,
  useAgentTestingGate,
} from "../../../behavior/agent-testing/use-agent-testing-gate.ts";
import {
  PageAbsentNotice,
  PermissionRequiredNotice,
} from "../../elements/agent-testing/agent-testing-gate-notices.tsx";
import { AgentTestingPage } from "../agent-testing/agent-testing-page.tsx";

function AgentTestingRoutePage() {
  switch (useAgentTestingGate()) {
    case "deciding":
      return null;
    case "absent":
      return <PageAbsentNotice />;
    case "refused":
      return <PermissionRequiredNotice permission={AGENT_TESTING_PERMISSION} />;
    case "open":
      return <AgentTestingPage />;
  }
}

export default AgentTestingRoutePage;

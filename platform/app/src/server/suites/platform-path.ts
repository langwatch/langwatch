/**
 * Where a suite opens in the platform.
 *
 * Two interfaces address the same rows. Agent Testing keeps the run plans
 * under `/agent-testing/results` and the test suites under
 * `/agent-testing/suites`; the Simulations pages it replaces keep them under
 * `/simulations`. Which one a link points at is decided per project by the
 * release flag, so a customer who has the new interface never gets a link into
 * the old one, and a customer who does not never gets a link they cannot open.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { featureFlagService } from "~/server/featureFlag";
import type { SuiteKind } from "./types";

/** The flag that decides which interface a project reads. */
const AGENT_TESTING_FLAG = "release_ui_agent_testing_v2_enabled";

/**
 * The path a suite opens at, without the project prefix.
 *
 * A flag read that fails answers the Simulations path: it is the interface
 * every project can open, so it is the safe answer.
 */
export async function suitePlatformPath({
  projectId,
  organizationId,
  slug,
  kind,
}: {
  projectId: string;
  organizationId: string;
  slug: string;
  kind: SuiteKind;
}): Promise<string> {
  const agentTesting = await readAgentTestingFlag({
    projectId,
    organizationId,
  });

  if (kind === "test_suite") {
    return agentTesting ? `/agent-testing/suites/${slug}` : "/simulations";
  }
  return agentTesting
    ? `/agent-testing/results/${slug}`
    : `/simulations/run-plans/${slug}`;
}

async function readAgentTestingFlag({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}): Promise<boolean> {
  try {
    return await featureFlagService.isEnabled(AGENT_TESTING_FLAG, {
      distinctId: projectId,
      projectId,
      organizationId,
    });
  } catch {
    return false;
  }
}

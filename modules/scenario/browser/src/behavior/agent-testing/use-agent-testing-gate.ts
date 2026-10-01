import { useFeatureFlag } from "@langwatch/browser-host/feature-flag";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";

import { useScenarioHost } from "../../model/scenario-host.ts";

export const AGENT_TESTING_FLAG = "release_ui_agent_testing_v2_enabled";
export const AGENT_TESTING_PERMISSION = "scenarios:view";

/** Main's route guards in order: the release flag, then the grant (page-structure.feature). */
export function useAgentTestingGate(): "deciding" | "absent" | "refused" | "open" {
  const host = useScenarioHost();
  const { project, organization, isLoading } = useOrganizationTeamProject();
  const organizationId = organization?.id ?? "";
  const flag = useFeatureFlag(AGENT_TESTING_FLAG, {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organizationId || NOT_TARGETED,
    enabled: !!organizationId,
  });
  if (isLoading || flag.isLoading) return "deciding";
  if (!flag.enabled) return "absent";
  if (!host.hasPermission(AGENT_TESTING_PERMISSION)) return "refused";
  return "open";
}
